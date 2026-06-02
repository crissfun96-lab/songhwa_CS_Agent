import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { menuCollections } from "@/lib/menu/firestore";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";
import type { MenuItem } from "@/lib/menu/types";

function refreshCache(tenantId: string) {
  buildCompactSummary(tenantId).catch((err) =>
    console.error("[admin] cache rebuild failed:", err),
  );
}

// GET /api/admin/menu — list ALL items (including inactive)
export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const snapshot = await getDb()
      .collection(menuCollections(tenantId).menuItems)
      .get();
    const items = snapshot.docs
      .map((d) => d.data() as MenuItem)
      .sort((a, b) => a.id.localeCompare(b.id));
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: errorMsg(error) },
      { status: 500 },
    );
  }
}

// POST /api/admin/menu — create new item
const CreateSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, "ID must be lowercase alphanumeric + underscore"),
  code: z.string().max(20).optional(),
  name_en: z.string().min(1),
  price_rm: z.number().min(0),
  category: z.string(),
  portion: z.string().optional().default(""),
  allergens: z.array(z.string()).optional().default([]),
  spice_level: z.number().int().min(0).max(3).optional().default(0),
  is_signature: z.boolean().optional().default(false),
  is_popular: z.boolean().optional().default(false),
  description_en: z.string().optional().default(""),
  tags: z.array(z.string()).optional().default([]),
});

export async function POST(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const body = await request.json();
    const parsed = CreateSchema.parse(body);

    const now = new Date().toISOString();
    const item: MenuItem = {
      id: parsed.id,
      code: parsed.code ?? null,
      names: { en: parsed.name_en },
      priceRm: parsed.price_rm,
      category: parsed.category as MenuItem["category"],
      portionDescription: parsed.portion,
      allergens: parsed.allergens as MenuItem["allergens"],
      spiceLevel: parsed.spice_level as MenuItem["spiceLevel"],
      isSignature: parsed.is_signature,
      isPopular: parsed.is_popular,
      description: { en: parsed.description_en },
      photoUrl: null,
      tags: parsed.tags,
      isActive: true,
      sourceVersion: `admin-${Date.now()}`,
      updatedAt: now,
    };

    await getDb()
      .collection(menuCollections(tenantId).menuItems)
      .doc(item.id)
      .set(item);
    refreshCache(tenantId);

    return NextResponse.json({ success: true, data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid data", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, error: errorMsg(error) },
      { status: 500 },
    );
  }
}

function errorMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : String(e);
}
