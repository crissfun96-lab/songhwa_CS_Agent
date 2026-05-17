import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { MENU_COLLECTIONS } from "@/lib/menu/firestore";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";

function refreshCache() {
  buildCompactSummary().catch((err) =>
    console.error("[admin] cache rebuild failed:", err),
  );
}

const UpdateSchema = z.object({
  name: z.string().optional(),
  description_en: z.string().optional(),
  end_date: z.string().optional(),
  is_active: z.boolean().optional(),
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
      sourceVersion: `admin-${Date.now()}`,
    };
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.description_en !== undefined) updates["description.en"] = parsed.description_en;
    if (parsed.end_date !== undefined) updates.endDate = parsed.end_date;
    if (parsed.is_active !== undefined) updates.isActive = parsed.is_active;

    await getDb()
      .collection(MENU_COLLECTIONS.promos)
      .doc(id)
      .update(updates);

    refreshCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await getDb()
      .collection(MENU_COLLECTIONS.promos)
      .doc(id)
      .update({
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
    refreshCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
