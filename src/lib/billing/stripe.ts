// Thin Stripe REST wrapper — no SDK dep, mirrors how we did Meta Cloud API.
// Use cases: create customer, create checkout session, handle webhook.

const STRIPE_API = "https://api.stripe.com/v1";

function requireKey(): string {
  const k = process.env.STRIPE_SECRET_KEY?.trim();
  if (!k) throw new Error("STRIPE_SECRET_KEY not configured");
  return k;
}

async function stripeFetch(path: string, opts: { method?: string; body?: Record<string, string> } = {}): Promise<Record<string, unknown>> {
  const key = requireKey();
  const body = opts.body ? new URLSearchParams(opts.body).toString() : undefined;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: opts.method ?? "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${(data as { error?: { message?: string } })?.error?.message ?? "unknown"}`);
  }
  return data as Record<string, unknown>;
}

export interface CreateCheckoutInput {
  tenantId: string;
  ownerEmail: string;
  priceId: string;            // Stripe price (recurring monthly per tier)
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}

// Create a Stripe Checkout Session — customer pays / enters card → redirect back.
export async function createCheckoutSession(input: CreateCheckoutInput): Promise<{ url: string; id: string }> {
  const body: Record<string, string> = {
    "mode": "subscription",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    "success_url": input.successUrl,
    "cancel_url": input.cancelUrl,
    "customer_email": input.ownerEmail,
    "metadata[tenantId]": input.tenantId,
    "subscription_data[metadata][tenantId]": input.tenantId,
    "allow_promotion_codes": "true",
  };
  if (input.trialDays && input.trialDays > 0) {
    body["subscription_data[trial_period_days]"] = String(input.trialDays);
  }
  const session = await stripeFetch("/checkout/sessions", { body });
  return { url: session.url as string, id: session.id as string };
}

// Customer portal — let tenants manage their own subscription, cards, etc.
export async function createBillingPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
  const session = await stripeFetch("/billing_portal/sessions", {
    body: {
      customer: customerId,
      return_url: returnUrl,
    },
  });
  return { url: session.url as string };
}

// Verify a webhook signature (Stripe sends Stripe-Signature header).
// Returns the parsed event if valid, null otherwise.
import crypto from "node:crypto";
export function verifyAndParseWebhook(
  rawBody: string,
  signature: string | null,
  tolerance = 300,
): Record<string, unknown> | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return null;

  const parts = Object.fromEntries(
    signature.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const ts = Number(parts.t);
  const sig = parts.v1;
  if (!ts || !sig) return null;
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return null;

  const signedPayload = `${ts}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"))) return null;
  } catch {
    return null;
  }

  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
}
