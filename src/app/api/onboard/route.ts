// Self-serve tenant onboarding from /business/signup.
// Creates a trial tenant doc + sends Telegram alert to Chris with next steps.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createTenant } from "@/lib/tenants/firestore";
import { sendToStaffRaw } from "@/lib/telegram";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { emitAsync } from "@/lib/metering/firestore";

const OnboardSchema = z.object({
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  // Enterprise tier is manual-only (custom pricing, custom limits). Removing
  // it from the public enum stops attackers self-signing into unlimited usage.
  tier: z.enum(["starter", "growth", "pro"]),
  businessName: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
  phone: z.string().min(5).max(30),
  cuisine: z.string().max(80).optional(),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = OnboardSchema.parse(body);

    // Rate limit — anti-abuse
    const ip = getClientIp(request);
    const ipOk = await rateLimit(`onboard-ip:${ip}`, { limit: 3, windowSeconds: 3600 });
    if (!ipOk.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many signups from this IP. Please contact us directly." },
        { status: 429 },
      );
    }

    const tenant = await createTenant(parsed);

    // Alert Chris — new tenant means he needs to provision Twilio/Meta/etc.
    const lines = [
      "🎉 <b>NEW TENANT SIGNED UP</b>",
      "",
      `🏪 <b>${tenant.business.displayName}</b> (slug: <code>${tenant.id}</code>)`,
      `👤 ${tenant.ownerName} · ${tenant.ownerEmail}`,
      `📞 ${tenant.business.phone}`,
      `💎 Tier: <b>${tenant.tier}</b> · 30-day trial`,
      "",
      "Next: provision their Twilio MY DID + Meta WA + paste creds into tenant config at /admin/tenants/" + tenant.id,
    ].join("\n");
    sendToStaffRaw(lines).catch((err) => console.error("[onboard] alert failed:", err));

    emitAsync("lead", { tenantId: "platform", metadata: { event: "tenant_created", tier: tenant.tier } });

    return NextResponse.json({
      success: true,
      data: {
        tenantId: tenant.id,
        slug: tenant.slug,
        trialEndsAt: tenant.trialEndsAt,
        nextSteps: [
          "Check your email for setup instructions",
          "We'll provision your phone number + WhatsApp within 48 hours",
          "Trial is 30 days — full refund if you cancel before billing starts",
        ],
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid signup data", details: error.issues },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: msg.slice(0, 200) },
      { status: msg.includes("already taken") ? 409 : 500 },
    );
  }
}
