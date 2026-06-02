// Billing "teeth" — serviceability gate for the multi-tenant Foxie PaaS.
//
// `tenantServiceState` answers ONE question: should this tenant's inbound
// traffic (web voice session config + WhatsApp replies) be served right now?
// It blocks suspended/cancelled tenants, expired trials with no subscription,
// and tenants that have blown their monthly usage caps.
//
// CRITICAL DESIGN: this is FAIL-OPEN. Any error — Firestore down, malformed
// data, missing tenant — resolves to `{ serviceable: true }`. We never block
// a paying/active tenant because of an infra hiccup. The active/pro default
// tenant (Songhwa) must ALWAYS be serviceable.

import { getTenant, effectiveLimits } from "../tenants/firestore";
import { getLiveMonthUsage } from "../metering/firestore";
import type { MeteringEventType } from "../metering/types";

export type ServiceUnavailableReason =
  | "suspended"
  | "cancelled"
  | "trial_expired"
  | "quota_exceeded";

export interface TenantServiceState {
  serviceable: boolean;
  reason?: ServiceUnavailableReason;
}

// Maps a tier-limit field to the metering counter that measures it.
// Limits whose value is -1 mean "unlimited" and never block (handled below).
const QUOTA_METRICS: ReadonlyArray<{
  limitKey: "voiceMinutesPerMonth" | "waConversationsPerMonth";
  meteringType: MeteringEventType;
}> = [
  { limitKey: "voiceMinutesPerMonth", meteringType: "voice_minute" },
  { limitKey: "waConversationsPerMonth", meteringType: "wa_inbound" },
];

export async function tenantServiceState(
  tenantId: string,
): Promise<TenantServiceState> {
  try {
    const tenant = await getTenant(tenantId);

    // Unknown/unseeded tenant — fail open, never block.
    if (!tenant) return { serviceable: true };

    if (tenant.status === "suspended") {
      return { serviceable: false, reason: "suspended" };
    }
    if (tenant.status === "cancelled") {
      return { serviceable: false, reason: "cancelled" };
    }

    // Expired trial with no paid subscription → blocked.
    if (
      tenant.status === "trial" &&
      tenant.trialEndsAt &&
      tenant.trialEndsAt < new Date().toISOString() &&
      !tenant.stripeSubscriptionId
    ) {
      return { serviceable: false, reason: "trial_expired" };
    }

    // Usage caps. -1 = unlimited (never blocks); >= 0 limits are enforced.
    const limits = effectiveLimits(tenant);
    for (const { limitKey, meteringType } of QUOTA_METRICS) {
      const limit = limits[limitKey];
      if (limit < 0) continue; // unlimited
      const usage = await getLiveMonthUsage(tenant.id, meteringType);
      if (usage > limit) {
        return { serviceable: false, reason: "quota_exceeded" };
      }
    }

    return { serviceable: true };
  } catch (err) {
    // FAIL-OPEN: never let billing logic take down service.
    console.error("[billing/lifecycle] tenantServiceState failed:", err);
    return { serviceable: true };
  }
}
