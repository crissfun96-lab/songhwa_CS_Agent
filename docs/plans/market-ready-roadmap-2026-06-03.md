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

### P0-3 — Multi-tenant WhatsApp inbound  ·  **✅ DONE & deployed (Cycle 2)**
- [x] `listActiveTenants()` + per-tenant iteration in `wa-dispatch` + `wa-queue-health` (Songhwa always included).
- [x] Atomic Firestore-transaction CLAIM (`processing=true` + 5-min stale recovery) → cron + webhook can't double-reply. Reviewed (claim confirmed correct), build green, deployed.
- [x] Cadence comments corrected (daily cron = safety-net; webhook = real-time).

### P0-4 — Billing lifecycle  ·  **✅ DONE & deployed (Cycle 2–3)** (1 follow-up: email)
- [x] `/business/welcome` (Cycle 2 — no more post-payment 404).
- [x] `billing-lifecycle` daily cron: suspends expired unpaid trials (`status→suspended`).
- [x] `tenantServiceState()` gate enforces `status` on inbound voice (`/api/menu/config` 403) + WA (silent skip). **Fail-open**: Songhwa active/pro always serviceable (verified live: config still 200).
- [x] Tier caps enforced via `getLiveMonthUsage` (`-1` = unlimited → never blocks pro/enterprise).
- [ ] _Follow-up:_ email the Stripe checkout link to suspended owners (no mailer in repo yet — cron currently logs the TODO).

---

## 🟠 P1 — First month after first external sale
- [x] **Reservation: customer confirmation** — ✅ wired into `create_reservation` (template-first + non-throwing text fallback, env-guarded). _Needs: Meta-approved `booking_confirmation` template._
- [x] **Reservation: day-before reminder cron** — ✅ `reservation-reminders` daily cron (KL tomorrow, `reminderSentAt` idempotency). _Needs: Meta-approved `booking_reminder` template._
- [x] **Availability turn-time** — ✅ **DONE & deployed (Cycle 5)**. Replaced the per-30-min-bucket model (a 7pm party "freed" its seats at 7:30 → unlimited oversell of a service) with **turn-time interval occupancy**: a booking holds `[T, T+turn)` (lunch 90m / dinner 120m); availability = `cap − peak concurrent pax`. One shared helper feeds both the pre-check and the in-transaction re-check (TOCTOU-safe). TDD (17 availability tests). Adversarial verify (3 lenses) caught + fixed 2 HIGH data-integrity holes: negative stored pax (clamped) and outside-hours rows bleeding into windows (skipped); re-verified CLEAN. [finding #2]
- [x] **Smart date resolver** — ✅ **DONE & deployed (Cycle 4)** — audit #2 elevated this to its #1 P0 (silent overbooking + lost lookups). `resolveDate()` (KL tz) at every query/write site + `TODAY:` injected into the prompt. Verified live. [finding #3]
- [ ] **Admin-editable capacity** — caps hardcoded (lunch 80/dinner 100). [finding #5]
- [x] **Tests** — ✅ harness established (vitest) — first 32 tests on the date resolver. Still need coverage for availability / tenant isolation / webhooks.
- [ ] **Observability** — structured logging + error monitoring (replace stray `console.*`).
- [ ] **Landing page** — third-party testimonials/case study, FAQ, clarify enterprise pricing, form validation.

## 🔁 Audit #2 (2026-06-03) — score 38 → 44; reprioritized remaining blockers
- [x] **Date anchor/normalization** — was audit#2's **#1 P0** → ✅ DONE (Cycle 4).
- [ ] **Monetization loop disconnected** (~1 day) — signup→trial but nothing maps tier→Stripe price, nothing calls `/api/billing/checkout`, no UI links it → self-serve signups can't pay. _Needs Chris's Stripe price IDs (env `TIER_PRICE_ID_*`); I wire the route + CTA._
- [ ] **Tenant resolution fails OPEN into Songhwa** (~2–3 days) — `resolveTenantId` defaults to "songhwa" for bare vercel.app / localhost / unmatched host; WA webhook routes by host not `phone_number_id`. Make it fail-CLOSED on non-default hosts + route WA by `phone_number_id`. _Needs subdomain/host strategy (ties into P0-2 auth)._
- [ ] **Firestore indexes only for `songhwa_*`** — a new tenant's composite queries throw FAILED_PRECONDITION (ops; latent until tenant #2).
- [ ] **Welcome page overclaims** — "Payment confirmed / email on its way" with no payment taken + no mailer → soften copy (quick).
- [ ] **No PDPA/privacy/terms pages** while recording customer voice + WhatsApp (legal gap) — draftable autonomously.
- [ ] **Phone "live handoff" never transfers** — says "connecting you" but Vapi `transferCall` isn't wired (needs `STAFF_TRANSFER_PHONE` + Vapi forwarding config).
- [x] **Welcome page overclaims** — ✅ DONE (Cycle 5). Killed the false "a confirmation email is on its way" (no mailer exists) + the "Payment confirmed" assertion (monetization loop disconnected); copy is now honest in both wired/unwired states, tied to the real WhatsApp onboarding.

## 🔁 Cycle 5 follow-up (surfaced by the turn-time adversarial review)
- [ ] **Reschedule write is not transaction-wrapped** (MEDIUM) — `lifecycle.ts updateReservation` does `checkAvailability` then a plain `ref.set()` outside any transaction. The customer-reachable reschedule path can race a concurrent booking; the new turn-time model *widens* the race window (any overlapping turn can tip the peak, not just the same 30-min slot). Fix: mirror `reservations/route.ts` — re-fetch the day inside `db.runTransaction` + `isCapacityExceeded(..., input.id)` before `tx.set`. (Pre-existing; deliberately scoped out of the tested turn-time hotfix.)

## ⚪ P2 — Nice-to-have
- [ ] Phone ordering (takeaway/pickup) — net-new revenue function.
- [ ] Native-audio model A/B for web voice (verify tool-calling first).
- [ ] Waitlist on fully-booked; deposit/no-show handling.

---
**Today's call (Chris):** voice-feel fix shipped; P0-1 (menu isolation) being implemented + build-verified this session; remaining P0s sequenced above.
