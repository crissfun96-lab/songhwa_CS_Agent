// Universal human-handoff endpoint.
// Customer says "I want to speak to a human RIGHT NOW" → AI calls request_human_handoff
// → this endpoint creates the escalation + alerts staff + returns next-action to AI.

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { createHandoff, HANDOFF_ETA_MINUTES } from "@/lib/handoff/firestore";
import { sendHandoffNotification } from "@/lib/telegram";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

function sanitize(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[*~`]/g, "").slice(0, 500).trim();
}

const HandoffSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().min(5).max(30),
  reason: z.string().min(1).max(500),
  urgency: z.enum(["high", "medium"]).optional(),
  channel: z.enum(["web", "phone", "wa"]).optional(),    // auto-default to web
  sessionId: z.string().optional(),
  vapiCallId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = HandoffSchema.parse(body);

    // Rate limit — handoff is rarer than callback, tighter cap
    const ip = getClientIp(request);
    const ipOk = await rateLimit(`handoff-ip:${ip}`, { limit: 8, windowSeconds: 3600 });
    const phoneOk = await rateLimit(
      `handoff-phone:${parsed.phone.replace(/\D/g, "")}`,
      { limit: 3, windowSeconds: 3600 },
    );
    if (!ipOk.allowed || !phoneOk.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many handoff requests. Please try again later." },
        { status: 429 },
      );
    }

    const handoff = await createHandoff({
      channel: parsed.channel ?? "web",
      customerName: sanitize(parsed.name),
      customerPhone: parsed.phone,
      reason: sanitize(parsed.reason),
      urgency: parsed.urgency,
      sessionId: parsed.sessionId,
      vapiCallId: parsed.vapiCallId,
    });

    // Always alert staff — urgency-aware formatting
    sendHandoffNotification(handoff).catch((err) =>
      console.error("[Telegram] handoff notification failed:", err),
    );

    // Tailor the AI's spoken response by action type
    let agentMessage: string;
    let etaMinutes: number = HANDOFF_ETA_MINUTES[handoff.urgency];
    switch (handoff.action) {
      case "transfer_now":
        agentMessage = `Connecting you to our manager now. Please hold for a moment. Ticket ${handoff.ticketId}.`;
        break;
      case "human_mode":
        agentMessage = `Got it — I've alerted our manager. They'll reply here within ${etaMinutes} minutes. Ticket ${handoff.ticketId}.`;
        break;
      case "callback_promised":
      default:
        agentMessage = `I've alerted our manager. They'll call you back at ${parsed.phone} within ${etaMinutes} minutes. Ticket ${handoff.ticketId}.`;
        break;
    }

    return NextResponse.json({
      success: true,
      data: {
        ticket_id: handoff.ticketId,
        action: handoff.action,
        eta_minutes: etaMinutes,
        // For Vapi phone tool: the number to dial for live transfer
        live_transfer_target: handoff.liveTransferTarget ?? null,
        // Pre-written line the AI should say
        agent_message: agentMessage,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid handoff data", details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[handoff] failed:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
