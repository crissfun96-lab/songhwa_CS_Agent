import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  updateReservation,
  cancelReservation,
} from "@/lib/reservations/lifecycle";

// Admin PATCH /api/admin/reservations/:id
const UpdateSchema = z.object({
  name: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  pax: z.number().int().min(1).max(50).optional(),
  menuChoice: z.string().optional(),
  remarks: z.string().optional(),
  reason: z.string().optional(),
  skipAvailabilityCheck: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateSchema.parse(body);

    const result = await updateReservation({
      id,
      updatedBy: "admin",
      actor: "admin-ui",
      reason: parsed.reason,
      skipAvailabilityCheck: parsed.skipAvailabilityCheck,
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

    return NextResponse.json({ success: true, data: result.reservation });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let reason = "Cancelled by admin";
    try {
      const body = await request.json();
      if (body?.reason) reason = body.reason;
    } catch {}

    const result = await cancelReservation({
      id,
      cancelledBy: "admin",
      actor: "admin-ui",
      reason,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: result.code === "not_found" ? 404 : 409 });
    }

    return NextResponse.json({ success: true, data: result.reservation });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
