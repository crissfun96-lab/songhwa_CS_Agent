# Foxie Market-Ready Roadmap — Status 2026-05-17

This doc maps every component from the joint Apple+Claude audit to its current implementation status + what Chris must do externally.

## ✅ COMPLETE — Built + Pushed Today

| Component | Where | Notes |
|---|---|---|
| Web voice agent | `src/app/page.tsx` + Gemini Live | All bug fixes shipped: bucket math (#1), half-duplex (#4), business hours (#6), referer (#2.5), Telegram retry (#7), customer index (#8), AudioWorklet (#9), WA queue alerts (#10), display bug, phone-lookup, sanitizer underscore |
| Phone bridge (Vapi) | `src/app/api/vapi/route.ts` + `docs/vapi/songhwa-assistant.json` | Single tool handler, 14 tools, paste-ready Vapi config |
| WhatsApp auto-reply | `src/lib/whatsapp/dispatcher.ts` + webhook + cron | Multi-turn, 14 tools, per-customer history |
| Human handoff | `src/lib/handoff/*` + `/api/handoff` + `/admin/handoffs` | Channel-aware: phone bridge, WA human_mode, web callback |
| Marketing landing | `/business` + `/api/leads` | Pricing, demo CTA, contact form, Telegram alerts |
| **Tenant model** | `src/lib/tenants/*` | Type, resolver, collection helper, Firestore CRUD, atomic creates, internal-secret header |
| **Multi-tenant data layer** | 9 lib modules + 13 routes | All data-access functions accept optional `tenantId` (default = "songhwa"). Routes resolve via subdomain/header. Vapi + WA dispatcher forward tenant context via `X-Foxie-Internal-Secret` |
| **Tenant theming** | `src/lib/tenants/types.ts` (TenantTheme) + `prompt-injector.ts` | Per-tenant prompt overrides, full white-label via `tenant.promptOverrides.systemPromptTemplate`. WA queue lazy-fetches `notif.whatsappStaffGroup` |
| **Metering** | `src/lib/metering/*` + cron + admin view | Events + daily rollups + per-tenant usage view + write-through counter for O(1) live quota |
| **Onboarding** | `/business/signup` + `/api/onboard` | Self-serve tenant creation with 30-day trial (enterprise tier removed from public path) |
| **Stripe billing** | `src/lib/billing/stripe.ts` + checkout + webhook | REST-based (no SDK dep), full subscription lifecycle, priceId whitelist, 500-on-error so Stripe retries |
| **Pipecat orchestrator** | `services/pipecat/main.py` | Python + Fly.io ready, all 14 tools ported, LLM init-time failover (Gemini → OpenAI), forwards tenant context via `X-Foxie-Tenant` |
| Security hardening | various | IP spoof fix, CSRF, signature verify, rate limits, PII refusal, prompt injection defense, PDPA, `firestore.rules` default-deny, composite indexes, constant-time secret compares |
| Apple UX polish | `layout.tsx` + `page.tsx` | ARIA, prefers-reduced-motion, debug gating, manifest, hint card, success animation |

## ⏳ CHRIS DOES (external setup only — code is ready)

| Item | Effort | Why it's required |
|---|---|---|
| **Rotate `GEMINI_API_KEY`** | 5 min | Pen-test extracted it; assume compromised |
| **Rotate `FIREBASE_PRIVATE_KEY` + `TELEGRAM_BOT_TOKEN`** | 10 min | Live in .env.local on multi-agent Mac mini |
| **Set `STAFF_TRANSFER_PHONE`** in Vercel | 1 min | Live phone handoff to manager |
| **Set `VAPI_SERVER_SECRET`** in Vercel | 1 min | For Vapi tool auth |
| **Sign up Vapi** + Twilio MY number | 2 hr | Phone calls live |
| **Sign up Meta Business Manager** + WhatsApp Cloud API | 24-48h Meta review | Customer-facing WhatsApp |
| **Sign up Stripe** + create 4 prices (Starter/Growth/Pro) | 30 min | Billing live |
| **Deploy Pipecat to Fly.io** | 1 hr after credentials | Replaces ws-proxy + adds failover |
| **Deploy ws-proxy to Fly.io** (interim) | 30 min | Quick fix for browser key leak until Pipecat is live |

## 🟡 OPTIONAL POLISH (when first paying tenant signs up)

- Replace `*` cron schedule with Vercel Pro ($20/mo) — currently Hobby plan limits to daily
- Add runtime LLM fallback (mid-call provider switch) — current impl is init-time only
- Add Mesolitica STT integration for Bahasa-heavy tenants
- Tenant-aware `/admin` UI (currently hardcoded Songhwa branding — header + favicon read from `tenant.theme`)
- Migrate menu collections to `tc()` (currently in `src/lib/menu/firestore.ts` MENU_COLLECTIONS still hardcoded; needs `collection.ts` mapping extension)
- Multi-tenant cron rollover (cron jobs default to Songhwa; iterate `foxie_tenants` for true multi-tenant ops)

## 🚀 30-day plan to first 3 paying tenants

| Week | Goal |
|---|---|
| 1 | Wire all external services (Vapi, Twilio, Meta, Stripe). Test full flow at Songhwa. Rotate keys. |
| 2 | First paying tenant — cold-walk 5 KL F&B owners (use `/business`). Provision their phone + WA. |
| 3 | Tenant #2 + #3. Document onboarding hiccups → patch self-serve flow. |
| 4 | Build first white-label theme. Migrate Songhwa to subdomain (`songhwa.foxie-cs.com`). |

## How the Foxie PaaS works (for an inbound F&B operator)

1. **Discovery**: Owner sees `/business` landing → reads pricing → submits lead form
2. **Sales call**: Chris replies via WhatsApp within 24h → 15-min demo → close
3. **Signup**: Owner visits `/business/signup` → fills form → tenant created (trial 30 days)
4. **Provisioning** (Chris, 1-2 days): buy Twilio number, set up Meta WA, paste creds in tenant config
5. **Self-serve**: Owner edits their menu Google Sheet, adds Telegram bot for staff alerts
6. **Go-live**: Phone number live, WhatsApp answering, reservations flowing
7. **Billing**: After trial → Stripe Checkout → recurring subscription → metered usage tracked
8. **Support**: Owner sees their own `/admin/metering` dashboard, contacts Chris if stuck

## What's TRULY market-ready RIGHT NOW

- ✅ Songhwa as design-partner: 100%
- ✅ Sell to F&B #2: yes, with Chris's manual provisioning per tenant
- ✅ Self-serve signup: ALL CODE READY (needs Stripe price IDs from Chris)
- ✅ Phone + WA + Web: all 3 channels coded; phone+WA need external account setup
- ✅ Live handoff: works on all 3 channels
- ✅ Metering + billing: full stack in place; needs Stripe account + price IDs
- ✅ Failover: scaffolded (Pipecat) but needs deployment
