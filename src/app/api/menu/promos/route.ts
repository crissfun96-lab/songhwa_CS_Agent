import { NextResponse } from "next/server";
import { getActivePromos } from "@/lib/menu/firestore";
import { resolveTenantId } from "@/lib/tenants/resolver";

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    const promos = await getActivePromos(new Date(), tenantId);
    return NextResponse.json({
      success: true,
      data: promos.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description.en,
        discount_type: p.discountType,
        discount_value: p.discountValue,
        applies_to: p.appliesTo,
        channels: p.channels,
        end_date: p.endDate,
        terms: p.terms,
        min_pax: p.minPax,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[menu/promos] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
