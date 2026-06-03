import { NextResponse } from "next/server";
import { getActivePromos } from "@/lib/menu/firestore";
import { isPromoChannel } from "@/lib/menu/promo-channel";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { log } from "@/lib/logger";

export async function GET(request: Request) {
  try {
    const tenantId = resolveTenantId(request);
    // Channel scope: callers pass ?channel=whatsapp|phone for their surface. Default to
    // dine_in so the reservation agent NEVER surfaces a third-party-only (Eatigo/Grab/
    // foodpanda) promo, even if a surface forgets to pass its channel.
    const rawChannel = new URL(request.url).searchParams.get("channel");
    const channel = isPromoChannel(rawChannel) ? rawChannel : "dine_in";
    const promos = await getActivePromos(new Date(), tenantId, channel);
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
    log.error({ event: "menu_promos_failed", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
