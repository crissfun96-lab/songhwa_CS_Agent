import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import {
  updateReservation,
  cancelReservation,
  normalizePhone,
} from "@/lib/reservations/lifecycle";
import { sendReservationUpdateNotification, sendReservationCancelNotification } from "@/lib/telegram";
import { enqueueReservationUpdate, enqueueReservationCancel } from "@/lib/wa-queue";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import type { Reservation } from "@/lib/types";

// Ownership verification — PATCH/DELETE require proof the caller owns this reservation.
// Accepts: sessionId (same voice session that created it) OR phone match.
async function verifyOwnership(
  id: string,
  providedPhone?: string,
  providedSessionId?: string,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; status: number; error: string }> {
  const doc = await getDb().collection("songhwa_reservations").doc(id).get();
  if (!doc.exists) {
    return { ok: false, status: 404, error: "Reservation not found" };
  }
  const r = doc.data() as Reservation;

  // Agent-created reservations carry the session ID. Same session = owner.
  if (providedSessionId && r.createdBySessionId === providedSessionId) {
    return { ok: true, reservation: r };
  }

  // Phone match (canonical form) = owner. Customer re-calling next day uses this path.
  if (providedPhone && normalizePhone(providedPhone) === normalizePhone(r.phone)) {
    return { ok: true, reservation: r };
  }

  return {
    ok: false,
    status: 403,
    error: "Ownership not verified. Provide the phone number used for this booking.",
  };
}

const UpdateSchema = z.object({
  name: z.string().max(120).optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  pax: z.number().int().min(1).max(50).optional(),
  menuChoice: z.string().max(500).optional(),
  remarks: z.string().max(1000).optional(),
  sessionId: z.string().optional(),
  phone: z.string().optional(),  // for ownership check
  reason: z.string().max(500).optional(),
});

// PATCH /api/reservations/:id — update (agent or returning customer)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateSchema.parse(body);

    // Rate limit per IP + reservation ID (prevents enumeration + DoS)
    const ip = getClientIp(request);
    const limit = await rateLimit(`res-patch:${ip}`, { limit: 20, windowSeconds: 3600 });
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Try again later." },
        { status: 429 },
      );
    }

    // Ownership check
    const ownership = await verifyOwnership(id, parsed.phone, parsed.sessionId);
    if (!ownership.ok) {
      return NextResponse.json({ success: false, error: ownership.error }, { status: ownership.status });
    }

    const result = await updateReservation({
      id,
      updatedBy: "agent",
      actor: parsed.sessionId,
      reason: parsed.reason,
      changes: {
        ...(parsed.name && { name: parsed.name }),
        ...(parsed.date && { date: parsed.date }),
        ...(parsed.time && { time: parsed.time }),
        ...(parsed.pax && { pax: parsed.pax }),
        ...(parsed.menuChoice !== undefined && { menuChoice: parsed.menuChoice }),
        ...(parsed.remarks !== undefined && { remarks: parsed.remarks }),
      },
    });

    if (!result.success) {
      return NextResponse.json(result, { status: result.code === "not_found" ? 404 : 409 });
    }

    sendReservationUpdateNotification(result.reservation, result.modification).catch((err) =>
      console.error("[Telegram] update notification failed:", err),
    );
    enqueueReservationUpdate(result.reservation, result.modification).catch((err) =>
      console.error("[WA queue] update enqueue failed:", err),
    );

    return NextResponse.json({
      success: true,
      data: result.reservation,
      summary: `Updated: ${Object.keys(result.modification.changes).join(", ")}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid update data", details: error.issues },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[reservations PATCH] failed:", msg);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}

// DELETE /api/reservations/:id — cancel (agent or customer)
const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
  sessionId: z.string().optional(),
  phone: z.string().optional(),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let body: { reason?: string; sessionId?: string; phone?: string } = {};
    try {
      const raw = await request.json();
      body = CancelSchema.parse(raw);
    } catch {
      // empty body acceptable, but ownership check will fail without sessionId/phone
    }

    const ip = getClientIp(request);
    const limit = await rateLimit(`res-delete:${ip}`, { limit: 10, windowSeconds: 3600 });
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests." },
        { status: 429 },
      );
    }

    const ownership = await verifyOwnership(id, body.phone, body.sessionId);
    if (!ownership.ok) {
      return NextResponse.json({ success: false, error: ownership.error }, { status: ownership.status });
    }

    const result = await cancelReservation({
      id,
      cancelledBy: "agent",
      actor: body.sessionId,
      reason: body.reason,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: result.code === "not_found" ? 404 : 409 });
    }

    sendReservationCancelNotification(result.reservation).catch((err) =>
      console.error("[Telegram] cancel notification failed:", err),
    );
    enqueueReservationCancel(result.reservation).catch((err) =>
      console.error("[WA queue] cancel enqueue failed:", err),
    );

    return NextResponse.json({
      success: true,
      data: result.reservation,
      summary: `Cancelled reservation for ${result.reservation.name} on ${result.reservation.date} at ${result.reservation.time}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[reservations DELETE] failed:", msg);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
