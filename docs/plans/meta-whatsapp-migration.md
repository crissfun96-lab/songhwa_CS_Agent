# Meta WhatsApp Cloud API Migration Guide

**Bug #3 fix.** This is the migration path from Baileys (commercial ban risk) to Meta's official WhatsApp Business Cloud API.

## Decision: Hybrid, not full migration

Meta Cloud API **does not support sending to WhatsApp groups**. The current Baileys staff group notifier sends to "Songhwa Reservations" group. So we keep Baileys for the staff internal use case (low ban risk because internal) and add Meta Cloud API for the **customer-facing PaaS direction**.

| Use case | Channel | Why |
|---|---|---|
| Staff group notifications | Baileys (current) + Telegram | Group support, low commercial visibility, internal-only |
| Customer booking confirmation | **Meta Cloud API** (new) | Official, scales, no ban risk |
| Customer reminders 24h+ later | **Meta Cloud API** (template) | Required for outside 24h window |
| Customer inbound WhatsApp (PaaS) | **Meta Cloud API** (webhook) | Receives messages, AI replies |
| Staff handoff WhatsApp | **Meta Cloud API** | Future PaaS feature |

## Code scaffolded (already in repo)

- `src/lib/whatsapp/meta-client.ts` — Meta API client (sendText, sendTemplate, helpers)
- `src/app/api/whatsapp/webhook/route.ts` — inbound webhook (GET verify + POST messages with HMAC verification)
- `src/app/api/whatsapp/send/route.ts` — manual send endpoint for testing

## What Chris must do (24-48h setup, mostly waiting on Meta)

### Step 1 — Create Meta Business Manager (15 min)
1. Go to https://business.facebook.com → create account if you don't have one
2. Verify business with SSM cert (Songhwa Sdn Bhd or your business name)
3. Add yourself as admin

### Step 2 — Create Meta App + WhatsApp Business Account (30 min)
1. Go to https://developers.facebook.com/apps → **Create App**
2. Type: **Business** → name it "Songhwa CS Agent"
3. Add product → **WhatsApp** → Setup
4. Create new WhatsApp Business Account (WABA) or use existing
5. Add a test phone number (free during dev) OR migrate your existing Songhwa number (`+60 11-5430 2561` or a new number)

### Step 3 — Get credentials (5 min)
From the WhatsApp → API Setup page, copy:
- **Phone number ID** → `META_WHATSAPP_PHONE_ID`
- **Temporary access token** (24h, for testing) → `META_WHATSAPP_TOKEN`
- **App secret** (Settings → Basic) → `META_WHATSAPP_APP_SECRET`

Generate your own random verify token (any string) → `META_WHATSAPP_VERIFY_TOKEN`.

For production, create a **System User** with permanent access token (don't use the 24h temp token).

### Step 4 — Configure webhook (5 min)
1. WhatsApp → Configuration → Webhook → **Edit**
2. Callback URL: `https://songhwa-cs-agent.vercel.app/api/whatsapp/webhook`
3. Verify token: paste your `META_WHATSAPP_VERIFY_TOKEN`
4. Click **Verify and save** — Meta will GET your endpoint and expect `challenge` echoed back. The scaffolded code already handles this.
5. Subscribe to fields: `messages` + `message_template_status_update`

### Step 5 — Set env vars in Vercel (5 min)
```
META_WHATSAPP_PHONE_ID=123456789012345
META_WHATSAPP_TOKEN=EAA... (long token)
META_WHATSAPP_APP_SECRET=abc123def456
META_WHATSAPP_VERIFY_TOKEN=your_random_string
```
Redeploy.

### Step 6 — Test send (2 min)
```bash
curl -X POST https://songhwa-cs-agent.vercel.app/api/whatsapp/send \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"to": "+60123456789", "body": "Test from Songhwa CS Agent"}'
```
Replace `+60123456789` with your own phone. You must have first messaged the Songhwa WA number from that phone (24h session window).

### Step 7 — Test inbound webhook (2 min)
1. Send "hello" to the Songhwa Meta-registered WhatsApp number from your phone
2. Check Firestore `wa_inbound_messages` collection — your message should appear

### Step 8 — (Optional) Create approved templates for >24h messaging
Meta requires pre-approved templates for messages sent outside the 24h customer-initiated window.

- WhatsApp Manager → Message Templates → Create
- Category: **UTILITY** (free utility messages, e.g., booking reminders)
- Template name: `booking_reminder`
- Body example:
  ```
  Hi {{1}}, reminder: your Songhwa booking is on {{2}} for {{3}} pax. See you!
  ```
- Submit → Meta reviews in 1-24 hours

## Migration phases

### Phase 1 — Both channels live (current after this setup)
- Staff notifications: Baileys (existing) ✓
- Customer confirmations: Meta Cloud API (new) ✓
- Inbound customer WA: Webhook persisting to Firestore ✓

### Phase 2 — Wire AI agent to inbound WA (Week 2)
- Cron or Cloud Function picks up new `wa_inbound_messages` with `processed: false`
- Calls Gemini Flash (or Mesolitica BM-specialist) for text-mode reasoning
- Uses same 14 tools as voice agent (search_menu, create_reservation, etc.)
- Replies via `sendText()` if inside 24h window, else uses a template

### Phase 3 — Multi-tenancy (PaaS)
- Each tenant has own `META_WHATSAPP_PHONE_ID` (Meta supports multiple phones per WABA)
- Webhook dispatches by `value.metadata.phone_number_id` → tenant config

### Phase 4 — Voice notes (audio messages)
- Meta sends `type: "audio"` messages with `audio.id`
- Download via `GET /{audio_id}` Graph API call
- Transcribe via Mesolitica Malaysian-Whisper (or Deepgram Nova-3)
- Feed transcription to agent

## Cost estimate (Malaysia rates, April 2026 update)

| Item | Cost |
|---|---|
| Service messages (within 24h customer window) | **Free** |
| Utility messages (booking confirm/reminder) | **~RM 0.05** per conv |
| Marketing messages | **~RM 0.38** per conv |
| Authentication messages | **~RM 0.20** per conv |

Typical F&B outlet: 300 customer conversations/mo × ~RM 0.03 blended = **~RM 9/mo per outlet**. Negligible at PaaS scale.

## Rollback plan

If Meta migration breaks anything:
1. Remove the `META_WHATSAPP_*` env vars
2. Existing Baileys + Telegram channels keep working unchanged
3. New code paths fail gracefully (`requireEnv` throws, route returns error)
4. No data loss — `wa_inbound_messages` keeps any received messages for replay

## References

- Meta WA Cloud API: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Webhook payload examples: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
- Pricing: https://developers.facebook.com/docs/whatsapp/pricing
- Template guidelines: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
