// Meta WhatsApp Business Cloud API webhook.
//
// Two responsibilities:
//   GET  → webhook verification (one-time, Meta sends ?hub.challenge)
//   POST → inbound message handling (customer messages, status updates)
//
// Configure in Meta App Dashboard:
//   Callback URL:  https://songhwa-cs-agent.vercel.app/api/whatsapp/webhook
//   Verify Token:  match META_WHATSAPP_VERIFY_TOKEN env var
//   Webhook fields: messages, message_template_status_update

import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import { log } from "@/lib/logger";
import { tc } from "@/lib/tenants/collection";
import { resolveTenantId } from "@/lib/tenants/resolver";
import { verifyMetaSignature } from "@/lib/whatsapp/verify-signature";

// ── GET: webhook verification (Meta hits this once when you save the URL) ──
// SECURITY: generic 403 regardless of config state (no information leak)
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.META_WHATSAPP_VERIFY_TOKEN?.trim();

  if (expectedToken && mode === "subscribe" && token === expectedToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// ── POST: inbound message ──
// Meta payload shape: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      field: string;
      value: {
        messaging_product: "whatsapp";
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: "text" | "image" | "audio" | "video" | "document" | "interactive" | "button" | "location" | "contacts";
          text?: { body: string };
          audio?: { id: string; mime_type: string };
          // ...other types
        }>;
        statuses?: Array<{
          id: string;
          status: "sent" | "delivered" | "read" | "failed";
          timestamp: string;
          recipient_id: string;
        }>;
      };
    }>;
  }>;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  // Verify the X-Hub-Signature-256 header to confirm the payload came from Meta.
  // (Logic + rationale live in @/lib/whatsapp/verify-signature — unit-tested there.)
  if (!verifyMetaSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ignored: true });
  }

  const db = getDb();
  const tenantId = resolveTenantId(request);
  const inboundCollection = tc(tenantId, "inbound_messages");

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Inbound messages → persist for later agent dispatch
      let hasNewMessage = false;
      for (const msg of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === msg.from);
        const docId = `wa_in_${msg.id}`;
        try {
          await db
            .collection(inboundCollection)
            .doc(docId)
            .set({
              id: docId,
              metaMessageId: msg.id,
              from: msg.from,
              customerName: contact?.profile.name ?? null,
              type: msg.type,
              text: msg.text?.body ?? null,
              audioMediaId: msg.audio?.id ?? null,
              receivedAt: new Date().toISOString(),
              metaTimestamp: msg.timestamp,
              phoneNumberId: value.metadata.phone_number_id,
              processed: false,
            });
          hasNewMessage = true;
        } catch (err) {
          log.error({ event: "wa_webhook_persist_failed", docId, tenantId, err });
        }
      }

      // Fire-and-forget dispatch trigger — faster reply latency than waiting
      // for the 1-minute cron. The cron remains the safety net.
      if (hasNewMessage && process.env.CRON_SECRET) {
        const baseUrl =
          process.env.NEXT_PUBLIC_APP_URL?.trim() ||
          "https://songhwa-cs-agent.vercel.app";
        fetch(`${baseUrl}/api/cron/wa-dispatch`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        }).catch((err) => log.error({ event: "wa_webhook_dispatch_trigger_failed", tenantId, err }));
      }

      // Delivery status updates → log only for now
      for (const status of value.statuses ?? []) {
        log.info({
          event: "wa_webhook_status_update",
          statusId: status.id,
          status: status.status,
          recipientPhone: status.recipient_id, // PII: masked by the logger (key matches /phone/)
          tenantId,
        });
      }
    }
  }

  // Meta requires 200 within ~5s or it retries
  return NextResponse.json({ received: true });
}
