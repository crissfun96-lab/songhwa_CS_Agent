// POST /api/whatsapp/send — manual send endpoint for testing Meta Cloud API.
// Protected by CRON_SECRET bearer token (same pattern as /api/business/sync).
//
// Usage:
//   curl -X POST https://songhwa-cs-agent.vercel.app/api/whatsapp/send \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"to": "+60123456789", "body": "Hello from Songhwa"}'

import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { sendText } from "@/lib/whatsapp/meta-client";

const SendSchema = z.object({
  to: z.string().min(5).max(30),
  body: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = SendSchema.parse(body);
    const result = await sendText(parsed.to, parsed.body);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message.slice(0, 300) },
      { status: 500 },
    );
  }
}
