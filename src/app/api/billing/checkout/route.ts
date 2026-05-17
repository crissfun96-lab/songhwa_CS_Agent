// Create a Stripe Checkout session for a tenant to subscribe.
// POST { tenantId, priceId, trialDays? } → { url } to redirect customer to.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { getTenant } from "@/lib/tenants/firestore";

const Schema = z.object({
  tenantId: z.string().min(2),
  priceId: z.string().min(1),
  trialDays: z.number().int().min(0).max(90).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = Schema.parse(body);

    const tenant = await getTenant(parsed.tenantId);
    if (!tenant) {
      return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://songhwa-cs-agent.vercel.app";
    const session = await createCheckoutSession({
      tenantId: tenant.id,
      ownerEmail: tenant.ownerEmail,
      priceId: parsed.priceId,
      successUrl: `${baseUrl}/business/welcome?tid=${tenant.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/business`,
      trialDays: parsed.trialDays,
    });

    return NextResponse.json({ success: true, data: session });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid checkout data", details: error.issues },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
