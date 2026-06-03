// Public lead-capture endpoint for the /business marketing page.
// Rate-limited (anti-spam) + Telegram-alert to Chris on every new lead.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createLead } from "@/lib/leads/firestore";
import { log } from "@/lib/logger";
import { sendLeadNotification } from "@/lib/telegram";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { emitAsync } from "@/lib/metering/firestore";

const LeadSchema = z.object({
  restaurantName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(120),
  contactRole: z.string().max(80).optional(),
  email: z.string().email().max(200),
  phone: z.string().min(5).max(30),
  outlets: z.number().int().min(1).max(10000),
  tier: z.enum(["starter", "growth", "pro", "enterprise", "unsure"]),
  cuisine: z.string().max(80).optional(),
  notes: z.string().max(1000).optional(),
});

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[*~`]/g, "").slice(0, 1000).trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = LeadSchema.parse(body);

    // Rate limit — same IP can submit 5 leads/hour
    const ip = getClientIp(request);
    const ipLimit = await rateLimit(`leads-ip:${ip}`, { limit: 5, windowSeconds: 3600 });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Please wait before submitting again." },
        { status: 429, headers: { "Retry-After": String(ipLimit.resetInSeconds) } },
      );
    }

    const lead = await createLead({
      restaurantName: sanitize(parsed.restaurantName),
      contactName: sanitize(parsed.contactName),
      contactRole: parsed.contactRole ? sanitize(parsed.contactRole) : undefined,
      email: parsed.email,
      phone: parsed.phone,
      outlets: parsed.outlets,
      tier: parsed.tier,
      cuisine: parsed.cuisine ? sanitize(parsed.cuisine) : undefined,
      notes: parsed.notes ? sanitize(parsed.notes) : undefined,
    });

    sendLeadNotification(lead).catch((err) =>
      log.error({ event: "lead_notification_failed", err }),
    );

    // Platform-level metering — track inbound leads for sales funnel analytics
    emitAsync("lead", { tenantId: "platform", metadata: { tier: lead.tier, outlets: lead.outlets } });

    return NextResponse.json({
      success: true,
      data: { lead_id: lead.id, message: "Thanks — we'll reach out within 24 hours." },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid form data", details: error.issues },
        { status: 400 },
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ event: "lead_post_failed", err: error });
    return NextResponse.json(
      { success: false, error: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
