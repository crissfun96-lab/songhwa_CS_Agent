# Songhwa CS Agent → Market-Ready Roadmap (2026-06-03)

Source: 6-agent end-to-end audit (overall **38/100**). Verdict: a genuinely well-built
**single-tenant** agent for Songhwa wearing a SaaS costume. Works great for Songhwa today;
onboarding a 2nd paying restaurant breaks in 4 independent ways. ~4–6 weeks of focused work to GA.

Dimension scores: Security 62 · AI Agent 61 · Architecture 52 · UI/UX 52 · Reliability 42 · **Product/SaaS 34**.

---

## ✅ DONE this session — Voice "feel" fix (Chris's #1 complaint)
- [x] Web (Gemini Live, `src/app/page.tsx`): killed the **1-second dead-air gap** — `silenceDurationMs 1000→600`, `endOfSpeechSensitivity LOW→HIGH`. Replies ~0.4s sooner.
- [x] Web voice swapped `Kore` (firm) → `Aoede` (warm). Alternatives noted inline (`Leda`/`Puck`/`Kore`).
- [x] System prompt (`src/lib/menu/prompt-injector.ts`): added **VOICE NATURALNESS** block (contractions, one-idea-per-turn, spoken numbers, no list-reading, warm acknowledgements).
- [x] Phone (Vapi, `docs/vapi/songhwa-assistant.json`): added `startSpeakingPlan`/`stopSpeakingPlan`/smart-endpointing/backchanneling; `endpointing 600→300`.
- [ ] **Chris to do in Vapi dashboard:** re-import assistant OR set the above 4 turn-taking fields; audition 2–3 voices; A/B the call feel.

---

## 🔴 P0 — Must fix before charging a 2nd restaurant

### P0-1 — Menu/price tenant isolation  ·  ~0.5–1 day  ·  **✅ DONE this session (build-verified)**
Hardcoded `songhwa_*` menu/promo/faq collections + `buildCompactSummary()` pre-seeded the prompt with
Songhwa dishes/prices/allergens. Tenant #2's AI would have quoted Songhwa's menu as fact (correctness + **allergen liability**). Fixed:
- [x] `menuCollections(tenantId)` resolver (default tenant = exact current names → zero migration).
- [x] `tenantId` threaded through all 17 read/write fns in `menu/firestore.ts`.
- [x] `buildCompactSummary(tenantId)` + `buildSystemPrompt` read per-tenant cache.
- [x] Public menu routes (search/dish/promos/allergens) call `resolveTenantId(request)`.
- [x] Admin menu/promo/stats routes + `sheet-sync` use tenant-aware names (stats also tenant-scopes reservations/complaints/callbacks via `tc()`).
- [x] `npm run build` → exit 0, compiled successfully, zero type errors.

### P0-2 — Per-tenant admin auth  ·  ~1 week
One shared `ADMIN_USERNAME/PASSWORD` fronts admin routes wired to `songhwa_*`. Tenant #2's staff would see/edit Songhwa PII.
- [ ] Real auth (Firebase Auth or NextAuth) with users→tenantId + roles.
- [ ] Derive `tenantId` server-side from session (NEVER from `?tenantId=` — `/admin/metering` currently trusts the query param).
- [ ] Every admin route reads/writes via `tc(tenantId, …)`; assert session tenant == resolved collection.

### P0-3 — Multi-tenant WhatsApp inbound  ·  ~0.5–1 day
`wa-dispatch` cron runs only the default tenant; non-Songhwa inbound is never answered. Cron is **daily** despite "every minute" comments; unguarded fire-and-forget can double-reply.
- [ ] `listActiveTenants()` + iterate in `wa-dispatch` and `wa-queue-health`.
- [ ] Atomically CLAIM each message (tx `processing=true`) to serialize concurrent runs.
- [ ] Fix cron cadence/comments (or commit fully to webhook-triggered dispatch).

### P0-4 — Billing lifecycle  ·  ~few days
Trial never converts; `tenant.status` never gates service; tier caps never enforced (uncapped Gemini/Vapi cost on us); Stripe `success_url` → `/business/welcome` **404s**.
- [ ] Build `/business/welcome` (quick).
- [ ] Daily cron: suspend trials past `trialEndsAt` w/o active sub; email checkout link.
- [ ] Enforce `tenant.status` on every inbound channel (voice/WA) — suspended = polite "service paused".
- [ ] Wire `getLiveMonthUsage` → enforce tier caps / overage.

---

## 🟠 P1 — First month after first external sale
- [ ] **Reservation: customer confirmation** — `sendBookingConfirmation()` exists but is never called (template + text fallback). [was finding #1]
- [ ] **Reservation: day-before reminder cron** — `sendBookingReminder()` exists, never scheduled. [finding #4]
- [ ] **Availability turn-time** — a 7pm booking frees seats at 7:30; overbooks across a service. [finding #2]
- [ ] **Smart date resolver** — server-side "this Saturday/tomorrow" → canonical KL date. [finding #3]
- [ ] **Admin-editable capacity** — caps hardcoded (lunch 80/dinner 100). [finding #5]
- [ ] **Tests** — zero automated tests today. Add vitest + critical-path coverage (availability, date, tenant isolation, webhooks).
- [ ] **Observability** — structured logging + error monitoring (replace stray `console.*`).
- [ ] **Landing page** — third-party testimonials/case study, FAQ, clarify enterprise pricing, form validation.

## ⚪ P2 — Nice-to-have
- [ ] Phone ordering (takeaway/pickup) — net-new revenue function.
- [ ] Native-audio model A/B for web voice (verify tool-calling first).
- [ ] Waitlist on fully-booked; deposit/no-show handling.

---
**Today's call (Chris):** voice-feel fix shipped; P0-1 (menu isolation) being implemented + build-verified this session; remaining P0s sequenced above.
