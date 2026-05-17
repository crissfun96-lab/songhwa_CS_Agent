// Create a Stripe Checkout session for a tenant to subscribe.
// POST { tenantId, priceId, trialDays? } → { url } to redirect customer to.
//
// Hardening (production):
//  - Rate-limited by IP (10/hr) to prevent DoS of Stripe budget
//  - priceId is whitelisted via STRIPE_ALLOWED_PRICE_IDS (comma-separated)
//    to stop attackers from substituting arbitrary Stripe products
//  - trialDays caps at 30 (was 90 — too generous on an unauthenticated route)

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { getTenant } from "@/lib/tenants/firestore";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

const Schema = z.object({
  tenantId: z.string().min(2),
  priceId: z.string().min(1),
  trialDays: z.number().int().min(0).max(30).optional(),
});

function allowedPriceIds(): Set<string> | null {
  const raw = process.env.STRIPE_ALLOWED_PRICE_IDS?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const limited = await rateLimit(`checkout-ip:${ip}`, { limit: 10, windowSeconds: 3600 });
    if (!limited.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many checkout attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limited.resetInSeconds) } },
      );
    }

    const body = await request.json();
    const parsed = Schema.parse(body);

    const allowed = allowedPriceIds();
    if (allowed && !allowed.has(parsed.priceId)) {
      return NextResponse.json(
        { success: false, error: "Invalid price" },
        { status: 400 },
      );
    }

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
