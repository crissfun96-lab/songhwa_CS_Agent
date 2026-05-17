import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { upsertCustomer } from "@/lib/customers";
import { sendStaffNotification } from "@/lib/telegram";
import {
  checkAvailability,
  findRecentDuplicate,
  isCapacityExceeded,
} from "@/lib/reservations/availability";
import { markDraftConverted } from "@/lib/reservations/intent";
import { normalizePhone } from "@/lib/reservations/lifecycle";
import { enqueueNewReservation } from "@/lib/wa-queue";
import type { Reservation } from "@/lib/types";

const COLLECTION = "songhwa_reservations";

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
function sanitizeForNotification(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")    // strip newlines (prevents fake staff messages)
    .replace(/[*_~`]/g, "")       // strip WA markdown (prevents fake bold/italic)
    .slice(0, 500)                // cap length
    .trim();
}

type CreateReservationResponse =
  | { success: true; data: Reservation }
  | {
      success: false;
      error: string;
      code: "duplicate" | "fully_booked" | "outside_hours" | "invalid_time" | "validation" | "server_error";
      alternatives?: Array<{ date: string; time: string; note: string }>;
      existingReservation?: Reservation;
    };

export async function POST(request: Request): Promise<NextResponse<CreateReservationResponse>> {
  try {
    const body = await request.json();
    const parsed = CreateReservationSchema.parse(body);

    // ── 1. Idempotency: detect duplicate booking attempt ───────
    const existing = await findRecentDuplicate(
      parsed.phone,
      parsed.date,
      parsed.time,
      60,
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

    // First: check availability (can't be inside transaction because of complex query)
    const availability = await checkAvailability(
      parsed.date,
      parsed.time,
      parsed.pax,
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
      date: parsed.date,
      time: parsed.time,
      pax: parsed.pax,
      menuChoice: sanitizeForNotification(parsed.menuChoice),
      remarks: sanitizeForNotification(parsed.remarks),
      createdAt: new Date().toISOString(),
      status: "confirmed",
      ...(parsed.sessionId && { createdBySessionId: parsed.sessionId }),
    };

    // Second: atomic write with re-check inside transaction.
    // Reuses isCapacityExceeded (same bucket/cap logic as checkAvailability above)
    // to close the TOCTOU window without inconsistent math.
    await db.runTransaction(async (tx) => {
      const dayQuery = db.collection(COLLECTION).where("date", "==", parsed.date);
      const daySnap = await tx.get(dayQuery);
      const dayReservations = daySnap.docs.map((d) => d.data() as Reservation);

      if (isCapacityExceeded(dayReservations, parsed.time, parsed.pax)) {
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
      parsed.date,
      parsed.time,
      parsed.pax,
    );

    if (parsed.sessionId) {
      markDraftConverted(parsed.sessionId, reservation.id).catch((err) =>
        console.error("[Reservations] draft conversion failed:", err),
      );
    }

    sendStaffNotification(reservation).catch((err) =>
      console.error("[Telegram] Notification failed:", err),
    );

    enqueueNewReservation(reservation).catch((err) =>
      console.error("[WA queue] enqueue failed:", err),
    );

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
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Reservations] POST error:", message);
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
