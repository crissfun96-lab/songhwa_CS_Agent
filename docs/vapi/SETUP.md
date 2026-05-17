# Vapi + Twilio Setup — Songhwa AI Receptionist on a Real Phone Number

End-to-end: customer dials your Malaysian number → Vapi picks up with Gemini → uses the 14 Songhwa tools → confirms reservation → transfers to a human if asked.

**Time:** ~2 hours of clicks (mostly Vapi + Twilio dashboards). Most time = Twilio number provisioning + Vapi dial-in setup.

**Cost:** ~RM 15/mo Twilio DID + ~$0.10/min usage. See `docs/plans/voice-stack-alternatives.md` for the math.

---

## Step 1 — Twilio Malaysian number (15 min)

1. Sign up at https://www.twilio.com (free credit covers testing)
2. **Phone Numbers** → **Manage** → **Buy a number**
3. Country: **Malaysia**. Capabilities: **Voice** (SMS optional). Local number preferred.
4. Buy. Note the number (e.g., `+603xxxxxxx` or `+601xxxxxxx`).
5. (Optional, +24h) **Regulatory compliance** — Twilio MY requires a local address bundle. Submit your SSM cert + Songhwa business address. Approval takes 24–48h.

---

## Step 2 — Vapi account (5 min)

1. Sign up at https://dashboard.vapi.ai (free trial credits)
2. **Settings** → **Provider keys** → connect:
   - **Twilio** — paste your Twilio Account SID + Auth Token
   - **Gemini** — paste your `GEMINI_API_KEY` (rotated one from after the security audit)
3. **Phone Numbers** → **Import from Twilio** → select the MY number you bought
4. Note the **Phone Number ID** Vapi assigns it

---

## Step 3 — Add the Vapi server secret to Vercel (2 min)

1. Generate: `openssl rand -hex 32`
2. Vercel → Songhwa project → **Settings** → **Environment Variables**:
   - `VAPI_SERVER_SECRET=<the random string above>`
3. Redeploy (or wait for the next push)
4. (Same generator command can produce `STAFF_TRANSFER_PHONE` is plain phone — set it to your manager's mobile, e.g. `+60123456789` — used for live human transfer)

---

## Step 4 — Create the Vapi Assistant (10 min)

1. Vapi dashboard → **Assistants** → **Create New**
2. **Import from JSON** → paste the contents of `docs/vapi/songhwa-assistant.json`
3. The JSON pre-fills:
   - Name: "Songhwa AI Receptionist"
   - Voice provider + voice (Cartesia Sonic, female warm — Malaysian-tolerant)
   - Model: `gemini-2.0-flash-realtime` (or your subscription's best Gemini Live model)
   - System prompt: **pre-loaded from `/api/menu/config`** at runtime so menu updates flow without re-editing Vapi
   - All 14 tool definitions with `serverUrl: https://songhwa-cs-agent.vercel.app/api/vapi`
   - `X-Vapi-Secret` header for server auth
4. **Save**

---

## Step 5 — Wire the phone number to the assistant (1 min)

1. Vapi → **Phone Numbers** → click your MY number
2. **Assistant** dropdown → select "Songhwa AI Receptionist"
3. Save

---

## Step 6 — TEST IT (5 min)

Call your Twilio Malaysian number from your phone.

Expected:
- Within ~1 second, Vapi answers
- Says the PDPA-compliant greeting in your language: *"Thank you for calling Songhwa Korean Cuisine! This call may be recorded for service quality. How can I help you today?"*
- You: *"I'd like to book a table for 4 this Saturday at 7pm, my name is Chris, phone 0123456789"*
- AI says filler, calls `check_availability`, then `create_reservation`
- AI confirms: *"Booking confirmed for Chris, 4 pax, Saturday at 7pm. Ticket sent to staff via Telegram and WhatsApp."*
- You: *"Transfer me to the manager"*
- AI: *"Connecting you now…"* → bridges to `STAFF_TRANSFER_PHONE`

---

## Step 7 — Verify the integration

| Check | How |
|---|---|
| Reservation in Firestore | `node scripts/diagnose-orphans.mjs` from project dir |
| Telegram alert in staff group | Should arrive ~2s after AI confirms |
| WhatsApp alert in Reservations group | Same timing (Baileys queue drains) |
| Handoff alert (if you said "transfer me") | Telegram should show the 🚨🚨 HUMAN HANDOFF block |
| Vapi call log | Vapi dashboard → Calls → review transcript + tool calls |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI doesn't pick up | Check Vapi → Phone Numbers shows your number "assigned to" the assistant |
| Tools return 401 | Verify `VAPI_SERVER_SECRET` in Vercel matches the X-Vapi-Secret header in the assistant JSON |
| AI speaks but doesn't call tools | Open Vapi assistant → Tools tab → confirm all 14 functions are listed with correct serverUrl |
| Reservations don't save | Check `https://songhwa-cs-agent.vercel.app/api/vapi` returns 401 (not 404) — confirms route is deployed |
| Long latency between turns | Switch Vapi to a region closer to KL (Vapi has SG region) |
| Live transfer doesn't work | `STAFF_TRANSFER_PHONE` env var must be set + in E.164 format `+60...` (no spaces or dashes) |
| Call connection fails | Twilio regulatory bundle may not be approved yet (24-48h) |

---

## Cost monitoring

| Item | Per call | Per month (200 calls × 3 min) |
|---|---|---|
| Twilio inbound voice | $0.032/min | ~$19 |
| Vapi platform | $0.05/min | ~$30 |
| Gemini Live audio | ~$0.023/min | ~$14 |
| Twilio MY DID | $4/mo flat | $4 |
| **Total** | **~$0.10/min** | **~$67/mo per outlet** |

Set Vapi monthly cap in dashboard → **Billing** → spending limit. Recommend $200/mo cap to start.

---

## When to migrate off Vapi → LiveKit

Vapi's $0.05/min platform fee is fine until ~5,000 voice-min/month (~167 calls/day). Past that, LiveKit Cloud + your own Python agent worker on Fly.io is ~$0.05/min cheaper. See `docs/plans/voice-stack-alternatives.md`.
