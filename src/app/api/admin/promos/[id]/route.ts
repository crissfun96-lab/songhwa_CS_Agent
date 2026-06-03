import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDb } from "@/lib/firebase-admin";
import { log } from "@/lib/logger";
import { menuCollections } from "@/lib/menu/firestore";
import { buildCompactSummary } from "@/lib/menu/prompt-injector";
import { resolveTenantId } from "@/lib/tenants/resolver";

function refreshCache(tenantId: string) {
  buildCompactSummary(tenantId).catch((err) =>
    log.error({ event: "admin_cache_rebuild_failed", err, tenantId }),
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
    const tenantId = resolveTenantId(request);
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
      .collection(menuCollections(tenantId).promos)
      .doc(id)
      .update(updates);

    refreshCache(tenantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
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
      .collection(menuCollections(tenantId).promos)
      .doc(id)
      .update({
        isActive: false,
        updatedAt: new Date().toISOString(),
      });
    refreshCache(tenantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
