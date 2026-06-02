import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { menuCollections } from "@/lib/menu/firestore";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";

// After any admin write, rebuild the compact summary cache so the agent
// sees the updated data on the next session. Fire-and-forget — don't block.
function refreshCache(tenantId: string) {
  buildCompactSummary(tenantId).catch((err) =>
    console.error("[admin] cache rebuild failed:", err),
  );
}

const UpdateSchema = z.object({
  price_rm: z.number().min(0).optional(),
  name_en: z.string().min(1).optional(),
  category: z.string().optional(),
  portion: z.string().optional(),
  allergens: z.array(z.string()).optional(),
  spice_level: z.number().int().min(0).max(3).optional(),
  is_signature: z.boolean().optional(),
  is_popular: z.boolean().optional(),
  is_active: z.boolean().optional(),
  description_en: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantId(request);
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateSchema.parse(body);

    const db = getDb();
    const docRef = db.collection(menuCollections(tenantId).menuItems).doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { success: false, error: "Item not found" },
        { status: 404 },
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      sourceVersion: `admin-${Date.now()}`,
    };

    if (parsed.price_rm !== undefined) updates.priceRm = parsed.price_rm;
    if (parsed.name_en !== undefined) updates["names.en"] = parsed.name_en;
    if (parsed.category !== undefined) updates.category = parsed.category;
    if (parsed.portion !== undefined) updates.portionDescription = parsed.portion;
    if (parsed.allergens !== undefined) updates.allergens = parsed.allergens;
    if (parsed.spice_level !== undefined) updates.spiceLevel = parsed.spice_level;
    if (parsed.is_signature !== undefined) updates.isSignature = parsed.is_signature;
    if (parsed.is_popular !== undefined) updates.isPopular = parsed.is_popular;
    if (parsed.is_active !== undefined) updates.isActive = parsed.is_active;
    if (parsed.description_en !== undefined) updates["description.en"] = parsed.description_en;
    if (parsed.tags !== undefined) updates.tags = parsed.tags;

    await docRef.update(updates);
    refreshCache(tenantId);

    const updated = await docRef.get();
    return NextResponse.json({ success: true, data: updated.data() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message.slice(0, 200) : "Update failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const tenantId = resolveTenantId(request);
    const { id } = await params;
    await getDb()
      .collection(menuCollections(tenantId).menuItems)
      .doc(id)
      .update({
        isActive: false,
        updatedAt: new Date().toISOString(),
        sourceVersion: `admin-${Date.now()}`,
      });
    refreshCache(tenantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message.slice(0, 200) : "Delete failed" },
      { status: 500 },
    );
  }
}
