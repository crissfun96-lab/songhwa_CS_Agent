// Daily billing-lifecycle cron — trial expiry enforcement.
//
// Sweeps every tenant in `status: "trial"`. Any trial whose `trialEndsAt` is
// in the past AND that has no `stripeSubscriptionId` (never converted to a
// paid plan) is moved to `status: "suspended"`. Once suspended, the
// serviceability gate (src/lib/billing/lifecycle.ts) stops serving its
// inbound traffic.
//
// NOTE: there is no email provider in this repo. We `log.warn` that a
// Stripe checkout link should be emailed to the owner — wiring an actual
// mailer is a follow-up task, intentionally out of scope here.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { log } from "@/lib/logger";
import { updateTenant } from "@/lib/tenants/firestore";
import { verifyBearer } from "@/lib/auth-secret";
import type { Tenant } from "@/lib/tenants/types";

const COLLECTION = "foxie_tenants";

export async function GET(request: Request) {
  // Generic 401 regardless of config state (no info leak).
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const nowIso = new Date().toISOString();
    const snap = await getDb()
      .collection(COLLECTION)
      .where("status", "==", "trial")
      .get();

    const suspendedIds: string[] = [];

    for (const doc of snap.docs) {
      // Force id from the document ID (never trust a stored `id` field) — a
      // malformed doc with a missing/blank id must NOT let updateTenant fall back
      // to the default tenant and accidentally suspend Songhwa.
      const tenant = { ...doc.data(), id: doc.id } as Tenant;

      // Only suspend trials that have actually expired AND never converted.
      if (!tenant.trialEndsAt || tenant.trialEndsAt >= nowIso) continue;
      if (tenant.stripeSubscriptionId) continue;

      await updateTenant(tenant.id, { status: "suspended" });
      suspendedIds.push(tenant.id);

      // Follow-up: no mailer in this repo yet. A Stripe checkout link should be
      // emailed to tenant.ownerEmail so they can reactivate by subscribing.
      log.warn({
        event: "billing_lifecycle_trial_suspended",
        tenantId: tenant.id,
        ownerEmail: tenant.ownerEmail,
      });
    }

    return NextResponse.json({ suspended: suspendedIds.length, ids: suspendedIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ event: "billing_lifecycle_error", err: error });
    return NextResponse.json(
      { success: false, error: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // Same logic as GET — POST allowed for manual/fire-and-forget triggers.
  return GET(request);
}
