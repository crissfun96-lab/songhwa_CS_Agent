import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { upsertCustomer } from "@/lib/customers";
import { sendStaffNotification } from "@/lib/telegram";
import {
  checkAvailability,
  findRecentDuplicate,
  isCapacityExceeded,
  normalizeTime,
  resolveCapacityConfig,
} from "@/lib/reservations/availability";
import { resolveDate } from "@/lib/reservations/date-resolver";
import { markDraftConverted } from "@/lib/reservations/intent";
import { normalizePhone } from "@/lib/reservations/lifecycle";
import { enqueueNewReservation } from "@/lib/wa-queue";
import { sendBookingConfirmation } from "@/lib/whatsapp/meta-client";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { emitAsync } from "@/lib/metering/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { tc } from "@/lib/tenants/collection";
import { log } from "@/lib/logger";
import type { Reservation } from "@/lib/types";

// SECURITY (Bug H4 fix): block CSRF — cross-origin reservation POSTs from
// attacker pages were succeeding. Combined with Bug C3 (no rate limit) this
// let an attacker spam staff Telegram via any victim's browser.
const ALLOWED_ORIGINS = new Set([
  "https://songhwa-cs-agent.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Direct curl / mobile / cron-style calls send no Origin — allow those
  // (browser CSRF requires an Origin to be set).
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

// Stricter schema with session ID for intent tracking
const CreateReservationSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  date: z.string().min(1).max(30),
  time: z.string().min(1).max(30),
  pax: z.number().int().min(1).max(50),
  menuChoice: z.string().max(500).optional().default(""),
  remarks: z.string().max(1000).optional().default(""),
  sessionId: z.string().optional(),
  // skipAvailabilityCheck REMOVED from public schema — was a security risk.
  // Admin endpoint /api/admin/reservations/:id still supports it internally.
});

// Sanitize user-provided text before it flows into WA/Telegram messages.
// Prevents prompt injection attacks via remarks that impersonate system text.
// LOW-3 fix: preserve `_` so real names like "Anne_Marie" or "O_Brien" survive.
// Only strip Telegram-MarkdownV2 + WA-markdown control chars + collapse newlines.
function sanitizeForNotification(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")   // strip newlines (prevents fake staff messages)
    .replace(/[*~`]/g, "")       // strip WA/Telegram markdown chars (NOT _ — keep names intact)
    .slice(0, 500)               // cap length
    .trim();
}

type CreateReservationResponse =
  | { success: true; data: Reservation }
  | {
      success: false;
      error: string;
      code:
        | "duplicate"
        | "fully_booked"
        | "outside_hours"
        | "invalid_time"
        | "validation"
        | "rate_limited"
        | "forbidden"
        | "server_error";
      alternatives?: Array<{ date: string; time: string; note: string }>;
      existingReservation?: Reservation;
    };

export async function POST(request: Request): Promise<NextResponse<CreateReservationResponse>> {
  try {
    // ── 0. CSRF + rate limit (Bug C3 + H4 fix) ─────────────────
    if (!isOriginAllowed(request)) {
      return NextResponse.json(
        { success: false, error: "Origin not allowed", code: "forbidden" },
        { status: 403 },
      );
    }

    const ip = getClientIp(request);
    const ipLimit = await rateLimit(`reservation-ip:${ip}`, { limit: 10, windowSeconds: 3600 });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many reservation attempts. Please wait.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(ipLimit.resetInSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = CreateReservationSchema.parse(body);
    const tenantId = resolveTenantId(request);
    const COLLECTION = tc(tenantId, "reservations");

    // Per-phone limit to stop a single number being spammed across IPs
    const phoneLimit = await rateLimit(`reservation-phone:${parsed.phone}`, { limit: 5, windowSeconds: 3600 });
    if (!phoneLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many reservations from this phone today. Call us directly.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(phoneLimit.resetInSeconds) } },
      );
    }

    // ── 0b. Resolve the date to canonical YYYY-MM-DD (KL tz) ───
    // The agent / customer may send "Saturday April 25" etc. Firestore stores and
    // queries dates as exact YYYY-MM-DD keys, so we MUST canonicalize before the
    // duplicate check, availability check, transaction query, AND before storing.
    const resolvedDate = resolveDate(parsed.date);
    if (!resolvedDate.ok) {
      return NextResponse.json(
        { success: false, error: "Could not understand the reservation date. Please give a clear date.", code: "invalid_time" },
        { status: 400 },
      );
    }
    const date = resolvedDate.date;

    // ── 1. Idempotency (pre-flight) ────────────────────────────
    // This catches user-level dupes serially. The HIGH-1 TOCTOU race is
    // closed by re-checking duplicate INSIDE the transaction below.
    const existing = await findRecentDuplicate(
      parsed.phone,
      date,
      parsed.time,
      60,
      tenantId,
    );
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: "A reservation with these details was already saved in the last hour",
          code: "duplicate",
          existingReservation: existing,
        },
        { status: 409 },
      );
    }

    // ── 2. Availability + save in a SINGLE ATOMIC TRANSACTION ──
    // Prevents TOCTOU race when two concurrent calls both pass the
    // availability check and both write, overbooking the slot.
    const db = getDb();
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reservationRef = db.collection(COLLECTION).doc(reservationId);

    // Resolve the tenant's capacity config ONCE (outside the txn) and use the SAME
    // snapshot for the pre-check AND the in-transaction re-check below — so they
    // can't disagree even if an admin edits capacity mid-request.
    const capacity = await resolveCapacityConfig(tenantId);

    // First: check availability (can't be inside transaction because of complex query)
    const availability = await checkAvailability(
      date,
      parsed.time,
      parsed.pax,
      undefined,
      tenantId,
      capacity,
    );
    if (!availability.available) {
      return NextResponse.json(
        {
          success: false,
          error: availability.reason === "fully_booked"
            ? "We're fully booked at that time. Here are some alternatives."
            : availability.reason === "outside_hours"
              ? "Requested time is outside our operating hours."
              : "Invalid time format.",
          code: availability.reason,
          alternatives: availability.alternatives,
        },
        { status: 409 },
      );
    }

    const reservation: Reservation = {
      id: reservationId,
      name: sanitizeForNotification(parsed.name),
      phone: parsed.phone,
      phoneNormalized: normalizePhone(parsed.phone),
      date,
      time: parsed.time,
      pax: parsed.pax,
      menuChoice: sanitizeForNotification(parsed.menuChoice),
      remarks: sanitizeForNotification(parsed.remarks),
      createdAt: new Date().toISOString(),
      status: "confirmed",
      ...(parsed.sessionId && { createdBySessionId: parsed.sessionId }),
    };

    // Second: atomic write with re-check inside transaction.
    // - Re-verifies capacity (closes TOCTOU on the capacity check)
    // - Re-verifies idempotency (closes TOCTOU on the duplicate check — HIGH-1 fix)
    // Both checks use the same dayReservations snapshot — single Firestore read.
    const normalizedNewTime = (() => {
      try {
        return new Date(reservation.createdAt).getTime();
      } catch {
        return Date.now();
      }
    })();
    const idempotencyCutoff = normalizedNewTime - 60 * 60 * 1000;
    const normalizedPhone = reservation.phoneNormalized;
    // Normalize so concurrent dupes expressed differently ("7 PM" vs "19:00")
    // still collide in the in-transaction guard below.
    let newTimeBucket: string;
    try {
      newTimeBucket = normalizeTime(parsed.time);
    } catch {
      newTimeBucket = parsed.time;
    }

    await db.runTransaction(async (tx) => {
      const dayQuery = db.collection(COLLECTION).where("date", "==", date);
      const daySnap = await tx.get(dayQuery);
      const dayReservations = daySnap.docs.map((d) => d.data() as Reservation);

      // HIGH-1 fix: idempotency inside the transaction — catches concurrent
      // identical POSTs that all passed the pre-flight `findRecentDuplicate`.
      const concurrentDup = dayReservations.find((r) => {
        if (r.status === "cancelled") return false;
        const samePhone =
          r.phone === parsed.phone ||
          (r.phoneNormalized && r.phoneNormalized === normalizedPhone);
        if (!samePhone) return false;
        try {
          if (normalizeTime(r.time) !== newTimeBucket) return false;
        } catch {
          return false;
        }
        try {
          return new Date(r.createdAt).getTime() > idempotencyCutoff;
        } catch {
          return false;
        }
      });
      if (concurrentDup) {
        throw new Error("concurrent_duplicate");
      }

      if (isCapacityExceeded(dayReservations, parsed.time, parsed.pax, undefined, capacity)) {
        throw new Error("race_detected");
      }

      tx.set(reservationRef, reservation);
    });

    // ── 4. Side effects (best-effort, never block response) ────
    await upsertCustomer(
      parsed.name,
      parsed.phone,
      parsed.menuChoice,
      parsed.remarks,
      date,
      parsed.time,
      parsed.pax,
      tenantId,
    );

    if (parsed.sessionId) {
      markDraftConverted(parsed.sessionId, reservation.id, tenantId).catch((err) =>
        log.error({ event: "reservation_draft_conversion_failed", tenantId, err }),
      );
    }

    sendStaffNotification(reservation).catch((err) =>
      log.error({ event: "telegram_notification_failed", tenantId, err }),
    );

    // Customer-facing WhatsApp confirmation (template-first w/ text fallback,
    // self-env-guarded). Fire-and-forget — must NEVER block or fail the booking.
    sendBookingConfirmation(reservation).catch((err) =>
      log.error({ event: "reservation_customer_confirmation_failed", tenantId, err }),
    );

    enqueueNewReservation(reservation, { tenantId }).catch((err) =>
      log.error({ event: "wa_queue_enqueue_failed", tenantId, err }),
    );

    // Metering — billable event for tier enforcement + analytics
    emitAsync("reservation", {
      tenantId,
      channel: "web",
      metadata: { reservationId: reservation.id, pax: reservation.pax },
    });

    return NextResponse.json({ success: true, data: reservation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing or invalid fields: ${error.issues.map((i) => i.path.join(".")).join(", ")}`,
          code: "validation",
        },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === "race_detected") {
      return NextResponse.json(
        {
          success: false,
          error: "That slot just filled up. Please try another time.",
          code: "fully_booked",
          alternatives: [],
        },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "concurrent_duplicate") {
      return NextResponse.json(
        {
          success: false,
          error: "A reservation with these details was just saved. Check your last booking.",
          code: "duplicate",
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "reservation_post_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200), code: "server_error" },
      { status: 500 },
    );
  }
}

// GET /api/reservations REMOVED from public — was a PII leak.
// Admin use: /api/admin/reservations (auth-gated via middleware).
// Voice agent UI now builds the list client-side from successful creates.
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "This endpoint is no longer public. Use /api/admin/reservations.",
    },
    { status: 404 },
  );
}
