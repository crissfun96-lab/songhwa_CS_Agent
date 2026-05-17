// Cron-triggered WhatsApp message dispatcher.
// Processes the wa_inbound_messages queue (filled by /api/whatsapp/webhook).
//
// Runs every minute via vercel.json. Also called fire-and-forget by the
// webhook for faster reply latency. The cron is the safety net.

import { NextResponse } from "next/server";
import { processInboundBatch } from "@/lib/whatsapp/dispatcher";
import { verifyBearer } from "@/lib/auth-secret";

export async function GET(request: Request) {
  // Generic 401 regardless of config state (no info leak)
  if (!verifyBearer(request.headers.get("authorization"), process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processInboundBatch(20);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[wa-dispatch] error:", message);
    return NextResponse.json(
      { success: false, error: message.slice(0, 300) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // Same logic as GET — POST allowed for the webhook's fire-and-forget trigger.
  return GET(request);
}
