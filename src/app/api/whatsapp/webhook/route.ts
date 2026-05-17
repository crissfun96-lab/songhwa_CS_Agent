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
import crypto from "node:crypto";

const INBOUND_COLLECTION = "wa_inbound_messages";

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

// Verify the X-Hub-Signature-256 header to confirm payload came from Meta.
// SECURITY (Bug C4 fix): no dev-mode bypass. If the secret isn't configured,
// the webhook MUST refuse — accepting unsigned payloads in any environment
// would let an attacker stuff wa_inbound_messages (Firestore cost) and poison
// downstream agent logic.
function verifySignature(rawBody: string, signature: string | null): boolean {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) return false; // not configured → refuse all signed POSTs
  if (!signature || !signature.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signature.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
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

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;

      // Inbound messages → persist for later agent dispatch
      for (const msg of value.messages ?? []) {
        const contact = value.contacts?.find((c) => c.wa_id === msg.from);
        const docId = `wa_in_${msg.id}`;
        await db
          .collection(INBOUND_COLLECTION)
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
          })
          .catch((err) => console.error("[WA webhook] persist failed:", err));
      }

      // Delivery status updates → log only for now
      for (const status of value.statuses ?? []) {
        console.log(
          `[WA webhook] status: ${status.id} → ${status.status} for ${status.recipient_id}`,
        );
      }
    }
  }

  // Meta requires 200 within ~5s or it retries
  return NextResponse.json({ received: true });
}
