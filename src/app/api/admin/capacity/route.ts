// Admin: read + edit a tenant's booking capacity (caps + table-turn times).
// Auth: covered by the Basic-Auth middleware on /api/admin/*. Tenant is resolved
// the same way as other admin routes (host/header). Unset fields fall back to the
// availability engine's DEFAULT_CAPACITY, so Songhwa is unchanged until edited.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { DEFAULT_CAPACITY, resolveCapacityConfig } from "@/lib/reservations/availability";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { DEFAULT_TENANT_ID } from "@/lib/tenants/types";
import { getOrSeedSonghwa, getTenant, updateTenantCapacity } from "@/lib/tenants/firestore";

// Sane bounds: caps 1..100000 pax, turns 1..600 minutes. All optional → partial edits.
const capacitySchema = z
  .object({
    lunchCap: z.number().int().min(1).max(100000).optional(),
    dinnerCap: z.number().int().min(1).max(100000).optional(),
    lunchTurnMinutes: z.number().int().min(1).max(600).optional(),
    dinnerTurnMinutes: z.number().int().min(1).max(600).optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const effective = await resolveCapacityConfig(tenantId);
    const tenant = await getTenant(tenantId);
    return NextResponse.json({
      success: true,
      data: {
        tenantId,
        effective,                          // what the booking engine actually uses
        defaults: DEFAULT_CAPACITY,         // values applied when a field is unset
        overrides: tenant?.capacity ?? null, // only the fields this tenant has customised
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message.slice(0, 200) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const tenantId = resolveTenantId(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = capacitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid capacity values", details: parsed.error.issues },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { success: false, error: "No capacity fields provided" },
      { status: 400 },
    );
  }

  try {
    // Ensure the tenant doc exists before writing (seed Songhwa on first touch).
    const tenant =
      tenantId === DEFAULT_TENANT_ID ? await getOrSeedSonghwa() : await getTenant(tenantId);
    if (!tenant) {
      return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 });
    }

    // PATCH semantics: merge provided fields onto any existing overrides.
    const merged = { ...(tenant.capacity ?? {}), ...parsed.data };
    await updateTenantCapacity(tenantId, merged);

    const effective = await resolveCapacityConfig(tenantId);
    return NextResponse.json({ success: true, data: { tenantId, effective, overrides: merged } });
  } catch (error) {
    // Tenant doc deleted between the existence check and the write (rare TOCTOU) →
    // Firestore NOT_FOUND. Return a clean 404 instead of leaking a 500 error string.
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 5 || code === "not-found") {
      return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message.slice(0, 200) }, { status: 500 });
  }
}
