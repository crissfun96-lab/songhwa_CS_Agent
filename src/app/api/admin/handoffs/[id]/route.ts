// Admin: resolve a handoff. PATCH with { resolvedBy, note? }.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { resolveHandoff } from "@/lib/handoff/firestore";

const ResolveSchema = z.object({
  resolvedBy: z.string().min(1).max(80),
  note: z.string().max(500).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = ResolveSchema.parse(body);
    await resolveHandoff(id, { resolvedBy: parsed.resolvedBy, note: parsed.note });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: error.issues },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: msg.slice(0, 200) },
      { status: msg.includes("not found") ? 404 : 500 },
    );
  }
}
