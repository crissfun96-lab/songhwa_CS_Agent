# Songhwa CS Agent — SaaS/PaaS Readiness Audit + Fix Plan

**Date:** 2026-05-17
**Auditor:** Foxie 🦊 (Claude Opus 4.7)
**Status:** Active — Fixes in progress

---

## TL;DR

**MVP status: 62/100** — works end-to-end but has 1 critical bug + 1 dangerous shortcut.
**PaaS opportunity: REAL.** SEA F&B AI-receptionist gap is wide open. KL network + Gemini cost edge = 6–9 month moat.
**Fix list: 5 days of focused work to reach "sellable".**

---

## What's Working (live-verified)

| Flow | Status | Notes |
|---|---|---|
| Voice chat (browser mic ↔ Gemini Live) | ✅ Works | 14 tools dispatched correctly |
| Menu Q&A (live Firestore) | ✅ Works | `/api/menu/search?q=bbq` → 11 results <2s |
| Reservation creation | ⚠️ Works WITH BUG #1 | Bucket math broken for evening |
| Telegram notifications | ✅ Works | 5 hooks fire (reserve / update / cancel / complaint / callback) |
| WhatsApp notifications | ✅ LIVE | `songhwa-wa` PM2 service, 15-day uptime, Baileys |
| Admin console | ✅ Built | menu / reservations / complaints / callbacks / promos / stats |
| Business hours sync | ❌ NOT RUNNING | `is_open: null` — Google Places not set up |
| Real phone calls | ❌ Not built | Roadmap Week 2 (Twilio + LiveKit) |
| WhatsApp inbound (customer-facing) | ❌ Not built | Only outbound staff alerts |
| Build (`npm run build`) | ✅ Green | All 35+ routes compile |

---

## Critical Bug List (priority order)

### 🔴 CRITICAL — Bug #1: Reservation race-detection bucket math
- **File:** `src/app/api/reservations/route.ts:125-138`
- **Problem:** Uses `parseInt(parsed.time.match(/\d+/)?.[0] ?? "0", 10)` — for "7:00 PM" extracts `7`, treats as lunch (cap 80) instead of dinner (cap 100). Inconsistent with `availability.ts` 30-min bucket logic. Race-detection misfires for every evening booking.
- **Fix:** Extract `isCapacityExceeded` helper in `availability.ts`, reuse in transaction.
- **Effort:** 30 min
- [x] Fixed 2026-05-17

### 🔴 HIGH — Bug #2: API key leaked to browser
- **File:** `src/app/api/songhwa-token/route.ts:87`
- **Problem:** When Google's ephemeral token endpoint 404s, raw `GEMINI_API_KEY` is returned to the browser. Visible in Network tab. Origin + rate limit are defense-in-depth but insufficient — anyone can scrape it.
- **Fix:** Server-side WebSocket proxy (Vercel Edge or Mac-mini service).
- **Effort:** 2 hours (code) + Chris must deploy proxy
- [x] Code complete ✅ `services/ws-proxy/` (Node.js + ws + Fly.io config) — Chris deploys

### 🔴 HIGH — Bug #2.5: Referer prefix-match bypass (BONUS from security agent)
- **File:** `src/app/api/songhwa-token/route.ts:67`
- **Problem:** `referer.startsWith("https://songhwa-cs-agent.vercel.app")` matched `https://songhwa-cs-agent.vercel.app.evil.com/` — attacker gets the API key. Confirmed exploitable by security agent.
- **Fix:** Parse referer as URL, compare `.origin` exactly.
- **Effort:** 10 min
- [x] Fixed 2026-05-17 ✅ `new URL(referer).origin === allowed`

### 🔴 HIGH — Bug #3: Baileys WhatsApp = commercial ban risk
- **Files:** `services/wa-notifier/`, `src/lib/wa-queue.ts`
- **Problem:** Baileys is unofficial reverse-engineered library. Meta TOS prohibits commercial use. The bot phone `+60 11-5435 8399` can be banned 2-8 weeks into commercial scaling. Reputation extinction event for paying customers.
- **Fix:** Migrate to Meta WhatsApp Business Cloud API. Keep Baileys as fallback only.
- **Effort:** 2-3 days code + Chris must set up Meta Business Manager (24-48h review)
- [ ] Pending — code scaffolded, Chris must do Meta setup

### 🟡 HIGH UX — Bug #4: Half-duplex audio (no barge-in)
- **File:** `src/app/page.tsx:491`
- **Problem:** Customer cannot interrupt the AI mid-sentence. The `if (isPlayingRef.current) return;` guard blocks mic capture while TTS plays. Echo cancellation already enabled — guard is overly defensive.
- **Fix:** Remove guard + handle Gemini's `serverContent.interrupted` event by clearing audio queue.
- **Effort:** 1 hour
- [x] Fixed 2026-05-17

### 🟡 MEDIUM — Bug #5: Cron schedule wrong
- **File:** `vercel.json`
- **Problem:** Says daily 5am, but `SETUP.md` claims every-5-min. Menu sheet edits lag up to 24h. Vercel Hobby plan limits crons.
- **Fix:** Upgrade Vercel to Pro ($20/mo) + change schedule to `*/5 * * * *`.
- **Effort:** 5 min (after upgrade)

### 🟡 MEDIUM — Bug #6: Business hours never synced
- **Endpoint:** `/api/business/status` returns `is_open: null`
- **Problem:** Google Places API key never configured. Customer asks "are you open?" — AI doesn't know.
- **Fix:** Run `SETUP.md` step 1a-1b (enable Places API + create key) → set `SONGHWA_PLACE_ID` env → trigger `/api/business/sync`.
- **Effort:** 10 min — Chris must do this

### 🟢 LOW — Bug #7: Telegram has no retry/DLQ
- **File:** `src/lib/telegram.ts:9-35`
- **Problem:** Send failures only logged. Brief Telegram outage = silent missed alerts.
- **Fix:** Exponential backoff retry (250ms, 1s, 4s) before giving up. Honors 4xx vs 5xx distinction.
- **Effort:** 2 hours
- [x] Fixed 2026-05-17 ✅ 3-attempt retry

### 🟢 LOW — Bug #8: Full-scan customer lookup
- **File:** `src/lib/customers.ts:8`
- **Problem:** Lookup-by-name does full collection scan. Breaks at ~5k customers.
- **Fix:** Indexed `where("nameLower", "==", needle).limit(1)` first; capped 500-doc scan as partial-match fallback.
- **Effort:** 1 hour
- [x] Fixed 2026-05-17 ✅ O(1) common case

### 🟢 LOW — Bug #9: ScriptProcessorNode deprecated
- **File:** `src/app/page.tsx:484`
- **Problem:** Deprecated Web Audio API. Works today, breaks in future Chrome/Edge.
- **Fix:** Migrate to `AudioWorkletNode`. Worklet at `public/audio-processor.worklet.js` runs in audio thread (better latency, future-proof).
- **Effort:** 3 hours
- [x] Fixed 2026-05-17 ✅ AudioWorklet + muted gain routing

### 🟢 LOW — Bug #10: No alerting on wa-queue dead items
- **File:** `services/wa-notifier/`
- **Problem:** Sustained Baileys outage produces silent failures. No alerts.
- **Fix:** Daily cron at 9am hits `/api/admin/wa-queue-health` → if attempts ≥ 3 and sentAt is null → Telegram alert to staff with diagnostic hints.
- **Effort:** 1 hour
- [x] Fixed 2026-05-17 ✅ `src/app/api/admin/wa-queue-health/route.ts` + `vercel.json` cron entry

---

## Manual Test Script (Chris must run after fixes)

Test against https://songhwa-cs-agent.vercel.app on phone, DevTools open on laptop:

- [ ] **1. Cold load** → header shows "Live menu · 14 tools" within 2s
- [ ] **2. Token check** → Network → `/api/songhwa-token` response. After Bug #2 fix: should NOT contain `apiKey` field
- [ ] **3. Language mirroring** → say *"你好，我想订位 4 个人"* → 100% Chinese reply
- [ ] **4. Halal honesty** → ask *"Is your food halal?"* → must say NON-halal
- [ ] **5. Promo guardrail** → ask *"Free dessert for my birthday?"* → must call `get_active_promos`
- [ ] **6. Full reservation** → book 3 days out, **7:00 PM**, 4 pax → verify (a) appears in list, (b) Telegram ping, (c) WhatsApp group ping
- [ ] **7. Duplicate guard** → same booking again → refuse with "already saved in the last hour"
- [ ] **8. Stress capacity** → 10× 10pax at same evening time → 11th must refuse with alternatives. **Critical test for Bug #1 fix**
- [ ] **9. Modify flow** → call back, "change to 8 PM" → must find by phone, update, fire Telegram
- [ ] **10. Cancel + complaint + callback** → each produces ticket ID + both Telegram + WhatsApp pings
- [ ] **11. Barge-in test** → start a reservation, then while AI is speaking, say "wait, change to 8 PM instead". AI should stop and respond. **Critical test for Bug #4 fix**

---

## PaaS Market Verdict

**Recommended delivery:** Hybrid (SaaS-first, PaaS at month 6)
**Pricing tiers (MYR + USD):**

| Tier | Price/mo | Voice min | WhatsApp | Channels | Target buyer |
|---|---|---|---|---|---|
| Starter | RM 299 ($69) | 200 | Limited | WA only | Solo café |
| Growth | RM 899 ($199) | 1,500 | Unlimited | WA + 1 voice number | Songhwa-peer (1-3 outlets) |
| Pro | RM 2,499 ($549) | 6,000 | Unlimited + voice notes | All + white-label | HWC / Tealive chains |

Gross margins: 40% / 65% / 80%. Beats Slang.ai by 60-80%, PolyAI by 99%, SleekFlow by bundling voice+WA at WhatsApp-only price.

**Chris's real moats:**
1. Operator credibility (actual F&B CEO, not SF VC-backed)
2. Distribution (75+ outlet KL network)
3. Language + halal + Manglish localization
4. Gemini Live cost edge (~50% cheaper COGS than Vapi/Retell)

**Window:** 6-9 months before SleekFlow adds voice or Slang.ai enters APAC.

---

## 90-Day Roadmap

### Days 1-14 — Fix the MVP (no sales yet)
- [x] Bug #1 (bucket math) — fixed 2026-05-17 ✅ verified build
- [x] Bug #4 (half-duplex audio) — fixed 2026-05-17 ✅ verified build
- [ ] **Bug #2 (API key proxy)** — STRATEGIC DECISION PENDING: quick WS proxy (2-3hr) vs Pipecat migration (1 week, also unlocks PaaS provider abstraction)
- [x] Bug #3 (Meta WhatsApp Cloud API) — code scaffolded ✅, see `docs/plans/meta-whatsapp-migration.md`. Chris must set up Meta Business Manager
- [ ] Bug #5 (Vercel Pro + cron fix) — $20/mo, Chris decision
- [x] Bug #6 (Google Places setup) — script written ✅ `scripts/setup-google-places.sh`. Chris must run after env vars set
- [ ] Manual test script — all 11 steps green (Chris to run)

### Days 15-30 — Songhwa + Byondwalls Design Partners
- [ ] Twilio MY DID ($4/mo) + LiveKit bridge → real phone calls
- [ ] 30-day live at Songhwa. Log every call. Document staff hours saved.
- [ ] Byondwalls as 2nd tenant → validate multi-tenant isolation
- [ ] Public demo video: "AI answering in 3 languages"
- **Success:** 80% call-completion, 30% phone→booking conv, 15hrs/week saved per outlet

### Days 31-60 — First 2 Paying F&B
- [ ] Cold-walk 5 KL F&Bs. 30-day free trial → RM 299/mo
- [ ] Self-serve onboarding (phone provisioning, menu upload, 1h go-live)
- [ ] Stripe MYR billing
- [ ] StoreHub integration (18k MY merchant unlock)
- **Success:** 2 paying logos, MRR RM 1,800, NPS ≥ 8

### Days 61-90 — Codify Into a Product
- [ ] Landing page with live demo + pricing + case studies
- [ ] Self-serve signup, 7-day trial no card
- [ ] Public docs + PaaS API reference
- [ ] HWC anchor white-label pilot (5-10 outlets)
- [ ] Reseller program v1 (30% recurring for agencies)
- **Success:** 8 paying logos, MRR RM 8,000, 1 enterprise pilot, 1 agency reseller

---

## Cheaper Voice Stack Alternatives (Research in Progress)

Currently using Gemini Live (~$0.10/min). Investigating:

| Stack | Cost/min | Best For |
|---|---|---|
| Current: Gemini Live | ~$0.10 | Production SaaS, multilingual |
| Deepgram + DeepSeek + Cartesia | ~$0.06 | Cost-optimized SaaS |
| Groq Whisper + Llama 3.3 + ElevenLabs Flash | ~$0.04 | Fast + cheap |
| 100% Local: Whisper.cpp + Ollama + Piper | $0/min | Songhwa-only on Mac mini |
| Self-hosted Vapi/Pipecat | ~$0.01 (infra) | PaaS scale |

**Recommendation (preliminary):**
- Songhwa MVP: keep Gemini Live
- PaaS: build provider-abstraction layer (LiveKit Agents or Pipecat) so each tenant picks tier

Full research dossier coming: `docs/plans/voice-stack-alternatives.md`

---

## Resume Protocol (if session restarts)

1. Read this file first
2. Check unchecked boxes
3. Continue from first unticked item
4. Update checkboxes as work completes
5. Reference: `docs/plans/voice-agent-v2.md` for original architecture

---

## Hardening Pass — 2026-05-17 PM (Plan 2 / Production Audit)

Parallel security + code + database review of the SaaS layer (tenants/, metering/, billing/, onboard/, handoff/). 17 surgical fixes landed; full audit kept in [hardening-2026-05-17.md](./hardening-2026-05-17.md) (deferred work + deep findings).

### Fixed in this pass

- [x] **Firestore defense-in-depth** — `firestore.rules` (default-deny client SDK), `firestore.indexes.json` (8 composite indexes for hot queries), `firebase.json` (deploy wiring). Deploy: `firebase deploy --only firestore:rules,firestore:indexes`
- [x] **`/api/billing/checkout`** — whitelisted `priceId` against `STRIPE_ALLOWED_PRICE_IDS`, 10/hr/IP rate limit, `trialDays` capped at 30 (was 90)
- [x] **`/api/onboard`** — stripped `enterprise` from public tier enum (now `starter|growth|pro`)
- [x] **`/api/songhwa-token`** — fallback rate limit 60→10/hr, added `STRICT_TOKEN_MODE=true` flag to disable the apiKey fallback entirely once `services/ws-proxy/` is deployed
- [x] **`tenants/resolver.ts`** — `X-Foxie-Tenant` header now requires matching `X-Foxie-Internal-Secret` (env: `FOXIE_INTERNAL_SECRET`); silently ignored otherwise. Added `wa` to reserved subdomains
- [x] **`tenants/firestore.ts`** — atomic `.create()` for `createTenant` + `getOrSeedSonghwa` (was TOCTOU race), narrowed `updateTenant` patch type to scalar fields (nested objects blocked by type system), reserved slugs include `wa`
- [x] **`billing/webhook`** — returns 500 on handler exception so Stripe retries (was 200, silently swallowing `updateTenant` failures)
- [x] **`billing/stripe.ts` `verifyAndParseWebhook`** — explicit length guard before `timingSafeEqual` (was relying on throw-then-catch)
- [x] **`metering/firestore.ts`** — sharded event IDs by tenant prefix (eliminates `m_*` hot key), `crypto.randomUUID` (eliminates burst collision), paginated `rollupDay` with 500-doc pages + batched writes (eliminates OOM/timeout), write-through counter doc `foxie_metering_counters/{tid}_{ym}_{type}` via `FieldValue.increment` → `getLiveMonthUsage` is now O(1) instead of O(N)
- [x] **`middleware.ts`** + new **`src/lib/auth-secret.ts`** — fixed length-oracle in `constantTimeEqual` (loop runs `maxLen` iterations regardless of input length). Shared `constantTimeStringEqual` + `verifyBearer` helpers usable from Edge and Node runtimes
- [x] **3 cron routes** (`metering-rollup`, `wa-dispatch`, `wa-queue-health`) — use `verifyBearer` for `CRON_SECRET` (constant-time)
- [x] **`rate-limit.ts` `getClientIp`** — `x-vercel-forwarded-for` now takes LAST hop (was first hop = client-controlled → spoofable)
- [x] **Build re-verified GREEN** — all 49 routes compile, TypeScript strict mode passes

### Deferred — bundled into Plan 3 (multi-tenant migration)

These were flagged CRITICAL/HIGH by the security review but are not surgical fixes — they require systematic refactor across many files:

- [x] **C2 — Hardcoded `songhwa_*` collections** — DONE 2026-05-17 PM. All 9 modules now use `tc(tenantId, name)` with optional tenant param. See `hardening-2026-05-17.md` → "Plan 3a wave" section.
- [x] **H7 — `wa_inbound_messages` cross-tenant collection** — DONE 2026-05-17 PM. WA webhook + dispatcher route through `tc()`.
- [x] **H11 — `handoff/firestore.ts` hardcodes `songhwa_handoffs`** — DONE 2026-05-17 PM. createHandoff + resolveHandoff + getWaConversationMode all accept tenantId.

### Deferred — low priority / require infra

- [ ] **C5 partial — `GEMINI_API_KEY` fallback path** — fully closed by deploying `services/ws-proxy/` to Fly.io + setting `STRICT_TOKEN_MODE=true`. Code is ready; awaits Chris deploy
- [ ] **H4 — Vapi bridge internal secret separation** — when Vapi traffic scales
- [ ] **H6 — Rate-limit fail-open** — add in-process LRU fallback when Firestore quota becomes a real risk
- [ ] **H2 — Per-tenant admin auth** — needed before onboarding tenant #2 with admin console access (operator-only today)
- [ ] **`console.log` cleanup** — 6 files use raw `console.error` / `console.warn`. Replace with structured logger when adding observability
- [ ] **React-hooks ESLint errors in admin pages** — 3 pre-existing: setState-in-effect (`callbacks/page.tsx:35`, `complaints/page.tsx:37`), impure-in-render (`handoffs/page.tsx:69`). Not security-blocking
- [ ] **Next.js 16 `middleware` deprecation** — rename to `proxy` per Next 16 conventions

### New env vars introduced (Chris: add to Vercel)

| Var | Required | Purpose |
|---|---|---|
| `STRIPE_ALLOWED_PRICE_IDS` | Production yes | Comma-separated allowlist of Stripe price IDs. Without it, checkout accepts any priceId (dev convenience) |
| `STRICT_TOKEN_MODE` | After ws-proxy deploy | Set to `true` to disable the API key fallback in `/api/songhwa-token` |
| `FOXIE_INTERNAL_SECRET` | Optional (multi-tenant) | Required if `X-Foxie-Tenant` header is set by internal callers (Vapi bridge, WA dispatcher). Subdomain resolution works without it |

### Deploy checklist for these fixes

```bash
# 1. Deploy Firestore rules + indexes
firebase deploy --only firestore:rules,firestore:indexes

# 2. Set new env vars in Vercel
#    STRIPE_ALLOWED_PRICE_IDS=price_xxx_starter,price_xxx_growth,price_xxx_pro
#    STRICT_TOKEN_MODE=true   ← only after ws-proxy is deployed

# 3. Push + deploy
git push && vercel --prod

# 4. Smoke-test the 11-step manual test script (see top of this doc)
```
