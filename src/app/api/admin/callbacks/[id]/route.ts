import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";

const UpdateSchema = z.object({
  status: z.enum(["queued", "in_progress", "completed", "missed", "cancelled"]).optional(),
  assignedTo: z.string().nullable().optional(),
  resolutionNote: z.string().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateSchema.parse(body);

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.status !== undefined) updates.status = parsed.status;
    if (parsed.assignedTo !== undefined) updates.assignedTo = parsed.assignedTo;
    if (parsed.resolutionNote !== undefined) updates.resolutionNote = parsed.resolutionNote;

    await getDb().collection("songhwa_callbacks").doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
