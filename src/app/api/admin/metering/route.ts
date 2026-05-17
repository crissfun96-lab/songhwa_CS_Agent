import { NextResponse } from "next/server";
import { getMonthUsage } from "@/lib/metering/firestore";
import { getTenant } from "@/lib/tenants/firestore";
import { effectiveLimits } from "@/lib/tenants/firestore";
import { TIER_PRICE_MYR } from "@/lib/tenants/types";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId") ?? "songhwa";
  const ym = url.searchParams.get("ym") ?? undefined;

  const [tenant, totals] = await Promise.all([
    getTenant(tenantId),
    getMonthUsage(tenantId, ym),
  ]);
  if (!tenant) {
    return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 });
  }

  const limits = effectiveLimits(tenant);
  const usage = {
    voiceMinutes: totals.voice_minute ?? 0,
    waOutbound: totals.wa_outbound ?? 0,
    waInbound: totals.wa_inbound ?? 0,
    toolCalls: totals.tool_call ?? 0,
    reservations: totals.reservation ?? 0,
    handoffs: totals.handoff ?? 0,
    complaints: totals.complaint ?? 0,
    callbacks: totals.callback ?? 0,
    leads: totals.lead ?? 0,
  };

  return NextResponse.json({
    success: true,
    data: {
      tenant: {
        id: tenant.id,
        name: tenant.business.displayName,
        tier: tenant.tier,
        status: tenant.status,
        priceMyr: TIER_PRICE_MYR[tenant.tier],
      },
      ym: ym ?? new Date().toISOString().slice(0, 7),
      usage,
      limits: {
        voiceMinutes: limits.voiceMinutesPerMonth,
        waConversations: limits.waConversationsPerMonth,
        outlets: limits.outlets,
      },
      utilization: {
        voicePct: limits.voiceMinutesPerMonth > 0
          ? Math.round((usage.voiceMinutes / limits.voiceMinutesPerMonth) * 100)
          : 0,
        waPct: limits.waConversationsPerMonth > 0
          ? Math.round((usage.waOutbound / limits.waConversationsPerMonth) * 100)
          : 0,
      },
    },
  });
}
