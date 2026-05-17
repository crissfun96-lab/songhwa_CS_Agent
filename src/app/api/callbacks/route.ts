import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createCallback } from "@/lib/callbacks/firestore";
import { URGENCY_ETA_MINUTES } from "@/lib/callbacks/types";
import { sendCallbackNotification } from "@/lib/telegram";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveTenantId } from "@/lib/tenants/resolver";

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[*_~`]/g, "").slice(0, 500).trim();
}

const CreateCallbackSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  reason: z.string().min(1).max(500),
  urgency: z.enum(["low", "medium", "high"]).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateCallbackSchema.parse(body);

    // Rate limit: prevent callback spam
    const ip = getClientIp(request);
    const ipOk = await rateLimit(`callback-ip:${ip}`, { limit: 15, windowSeconds: 3600 });
    const phoneOk = await rateLimit(`callback-phone:${parsed.phone.replace(/\D/g, "")}`, {
      limit: 5,
      windowSeconds: 3600,
    });
    if (!ipOk.allowed || !phoneOk.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many callback requests. Please try again later." },
        { status: 429 },
      );
    }

    const callback = await createCallback({
      name: sanitize(parsed.name),
      phone: parsed.phone,
      reason: sanitize(parsed.reason),
      urgency: parsed.urgency,
      tenantId: resolveTenantId(request),
    });

    sendCallbackNotification(callback).catch((err) =>
      console.error("[Telegram] callback notification failed:", err),
    );

    return NextResponse.json({
      success: true,
      data: {
        ticket_id: callback.ticketId,
        eta_minutes: URGENCY_ETA_MINUTES[callback.urgency],
        promise_by: callback.promiseByIso,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid callback data", details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[callbacks] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
