# Human-Parity Reservation Loop — "replace a real human taking reservations"

> Mission (Chris, 2026-06-04): **fix → review → fix → review until the reservation agent is market-ready and can replace a competent human host** taking bookings across web voice (Gemini Live), phone (Vapi), and WhatsApp (Gemini text).

**The bar — a competent human host NEVER:** loses a booking; double-books or promises a table without checking; hallucinates menu/prices/promos/hours/policies; gets stuck / goes silent; ignores a correction; mishandles ambiguity; forgets context; fails to clearly confirm; behaves differently across channels; leaks another customer's data.

**Method:** Evaluator-Optimizer loop. Each iteration = adversarial multi-lens review (only code-grounded, skeptic-verified gaps survive) → fix P0/P1 with TDD → deploy → re-review.

---

## Iteration 1 — Reliability dimension (2026-06-04)

⚠️ **Review was PARTIAL:** of 6 review dimensions, only **Reliability** produced structured output; the other 5 reviewers (WhatsApp-parity, voice-completeness, create/lifecycle-correctness, conversational-parity, truth/safety) failed to emit structured output (workflow-mechanics failure, not a code result). **Those 5 dimensions are still owed — re-run them in iteration 2.**

Reliability produced **5 confirmed, skeptic-verified gaps** (0 P0, 2 P1, 3 P2):

### ✅ FIXED & deployed (this iteration)
- [x] **P1 — Tool-loop exhaustion hid a successful booking** (`dispatcher.ts`). If `create_reservation` was the call on the final tool round, the loop exited with `finalText=null` → customer got "Sorry, I'm having trouble… try again" **even though the booking was committed in Firestore**. A human would never say that. **Fix:** bumped `MAX_TOOL_ROUNDS` 4→6 + new pure `resolveFinalReply()` (TDD, 13 tests) that, when the loop exits silent after a successful create/update/cancel, sends the tool's confirmation message — never the failure line. `src/lib/whatsapp/reply-resolution.ts`.
- [x] **P1 — Send-failure consumed the message with no retry** (`dispatcher.ts`). Booking committed, but if the confirmation `sendText` threw (transient Meta outage), the batch catch marked the message `processed:true` → customer never told, staff notified as if confirmed, no retry (cron only re-runs `processed==false`). **Fix:** mark `processed` only AFTER successful delivery; on send failure return `retryable` → batch stashes `pendingReply` + leaves the message unprocessed; an idempotent **fast-path** re-sends `pendingReply` verbatim on the next run WITHOUT re-running the model loop or re-booking.

### ⬜ Open follow-ups (next iterations)
- [ ] **P2 — No per-inbound-message idempotency key** (replay after a mid-loop crash can re-append the user turn / re-book). The new `pendingReply` fast-path covers the post-compute crash (the common case); the remaining gap is a crash *during* the loop. Proper fix: carry `metaMessageId` onto the `ConvMessage` (dedupe append) + pass it as an idempotency key into `create_reservation` and check it server-side in addition to the 60-min duplicate guard.
- [ ] **P2 — Draft safety-net is LLM-discretionary** — `save_reservation_draft` is only written if the model calls it. A single-turn create that then fails leaves zero artifact for staff. Fix: server-side upsert a draft from the create args (when `sessionId` present) on every create attempt, then `markDraftConverted` on success.
- [ ] **P2 — Reminder cron has no retry / failure marker** — `reservation-reminders` runs once daily and `where(date == tomorrow)`; a transient Meta failure during that single window **permanently** drops tomorrow's reminders (never re-selected). Fix: `reminderAttempts`/`reminderFailedAt` fields + re-sweep + staff alert on cap (mirror the existing `wa-queue-health` dead-letter pattern).
- [ ] **P3 — `pendingReply` retry has no attempt cap** (introduced by the P1 fix) — a permanently-undeliverable number would re-attempt every cron/webhook run. Add a `pendingReplyAttempts` cap → mark processed + alert staff after N.

### ⬜ Owed from iteration 1 (reviewers that failed to report)
- [ ] Re-run **WhatsApp channel parity** review (does WA wire the full tool set + flow vs voice?)
- [ ] Re-run **Voice completeness** review (web Gemini Live + Vapi end-to-end booking, turn-taking)
- [ ] Re-run **Create/lifecycle correctness** review (do engine error codes match what the prompt promises: duplicate/fully_booked/validation/server_error/past_reservation?)
- [ ] Re-run **Conversational parity** review (corrections, ambiguity, multi-intent, returning customer)
- [ ] Re-run **Truthfulness & safety** review (hallucination surface, prompt-injection, PDPA)

---

## Iteration 2 — full 5-dimension review (2026-06-04)

Re-ran the 5 dimensions that failed in iteration 1 (hardened StructuredOutput mandate worked — all reported). **17 confirmed, skeptic-verified (0 P0, 6 P1, 10 P2, 1 P3); 2 rejected.**

### ✅ FIXED & deployed (iteration 2 batch — the WhatsApp-reliability + error-handling slice)
- [x] **P1 — History trim orphaned tool-call pairs → Gemini 400 → silent customer** (`conversation.ts`). `.slice(-MAX_TURNS)` could start the window on an orphan functionResponse; Gemini rejects it (400), the dispatcher threw, the customer got no reply on a long thread. **Fix:** `sanitizeHistoryForModel()` (TDD, 8 tests) drops leading dangling tool turns so the window always starts on a valid turn; wired into the dispatcher before `toGeminiContents`.
- [x] **P1 — Couldn't modify/cancel a cross-channel booking (403)** (`prompt-injector.ts`). `update_reservation`/`cancel_reservation` tool declarations had no `phone` param, so ownership verification (sessionId-or-phone) failed for a booking made on another channel → 403. **Fix:** added optional `phone` to both declarations + MODIFY/CANCEL flow steps instruct the agent to pass the booking's phone from `find_reservation` (dispatcher already forwards it).
- [x] **P1 — Silent on non-text messages** (`dispatcher.ts`). An image/audio/sticker got `replyText:undefined` → no reply at all. **Fix:** trilingual (EN/中文/BM) canned ack asking for text, placed AFTER the human-handoff + billing gates so we never talk over a human or a suspended tenant.
- [x] **P1 — CANCEL flow had ZERO error handling** + **P2 — CREATE/UPDATE error codes incomplete** (`prompt-injector.ts`). Verified the exact codes each endpoint emits and aligned the prompt: CREATE now covers outside_hours/invalid_time/rate_limited/forbidden (was 4 codes); UPDATE covers not_found/cancelled/outside_hours/invalid_time/no_changes (was 2); CANCEL now covers not_found/already_cancelled/past_reservation (was 0).

## Iteration 3 — truthfulness fixes (2026-06-04)

### ✅ FIXED & deployed
- [x] **P1 — Promos not channel-scoped** — `getActivePromos` never filtered by channel, so the agent could quote an Eatigo/Grab/foodpanda discount on a dine-in reservation. **Fix:** pure `promoAllowedOnChannel()` (TDD, 6 tests) — a reservation conversation only sees `dine_in` promos (+ its own direct channel); wired into `getActivePromos(channel)`, the `/api/menu/promos` route (defaults to `dine_in` so third-party promos can't leak even if a surface forgets), and all 3 surfaces (WhatsApp→whatsapp, Vapi→phone, web→phone).
- [x] **P2 — `today_hours` always returned day index 0 (Sun/Mon)** — agent quoted the wrong day's hours 6 days/week. **Fix:** `todayHoursText()` + `klDayOfWeek()` (TDD, 5 tests) select the `hours` entry matching today's KL weekday (source-independent via explicit `dayOfWeek`); wired into `/api/business/status`.

## Iteration 4 — conversational polish + close self-introduced debt (2026-06-04)

### ✅ FIXED & deployed
- [x] **P2 — Voice number-formatting leaked into WhatsApp text** — agent wrote "three fifty-eight ringgit" and spelled phone digits one-by-one in chat. **Fix:** WhatsApp override block now countermands the voice formatting rules (write RM358, "7:00 PM", phones as digits).
- [x] **P2 — No fuzzy-time guidance** ("7-ish", "around 7", "this weekend") — agent could pass a vague time to availability/booking. **Fix:** new flow step a2 — pin down + confirm a specific date/time before checking availability.
- [x] **P2 — WhatsApp returning-customer recognition suppressed** by the "no filler" override. **Fix:** WhatsApp override now instructs a silent `lookup_customer` on the first reply → greet by name if known.
- [x] **P3 — `pendingReply` retry had no attempt cap** (debt from iteration 1) — a permanently-undeliverable number would re-attempt every cron/webhook run forever. **Fix:** `pendingReplyAttempts` counter + `MAX_PENDING_REPLY_ATTEMPTS=5` → gives up (marks processed, logs `wa_reply_undeliverable_gave_up`) after the cap.

### ⬜ Confirmed, still open (next iterations)
- [ ] **P1 — Phone "transfer me to a manager NOW" is a dead transfer** (Vapi) — promises a live transfer that never bridges. Fix needs a Vapi `transferCall` tool in `docs/vapi/songhwa-assistant.json` + **Chris to re-import the assistant** (Vapi dashboard). _Needs-Chris._
## Iteration 5 — never-lose-a-booking (2026-06-04)

### ✅ FIXED & deployed
- [x] **P2 — Draft safety-net was LLM-discretionary** — only existed if the agent called `save_reservation_draft`; a single-turn create that then failed left zero recoverable lead. **Fix:** `/api/reservations` POST now does a best-effort `upsertDraft()` from the create args up-front (after date-resolution, before the idempotency/availability checks, guarded by `sessionId`), so EVERY create attempt leaves a draft; the existing `markDraftConverted` flips it on success. A failed/duplicate/dropped create now always leaves staff a lead. (Integration-wired + build-verified; Firestore I/O, not unit-testable here.)

### ⬜ Reliability tail — still open
- [ ] **P2 — Per-inbound-message idempotency key** (`metaMessageId`) for create + history append. _(iteration 6 — TDD the dedupe.)_
- [ ] **P2 — Reminder-cron retry/failure-marker** — once-daily `where(date==tomorrow)` makes a missed reminder permanently unrecoverable. _(iteration 6.)_
- [ ] **P2 — parity polish (remaining):** phone caller-ID discarded (forces reciting number); cross-channel success-message wording inconsistency; Vapi tool-schema hand-fork drift; WhatsApp assumes sender==booking number (confirm before lookup/modify).
- [ ] **P3 — Web voice has no proactive greeting** (stays silent until user speaks).
- [ ] _(rejected by skeptic, not real: find-reservation guardrail "stripped" on phone; mid-booking-correction staleness — both refuted with code evidence.)_

## Iteration 6 — regression-focused RE-REVIEW + fixes (2026-06-04)

Ran a 3-lens re-review (regression / fix-incomplete / fresh-blockers) after 5 fix iterations. **8 confirmed (2 P1, 4 P2, 2 P3), 2 rejected.** It caught real holes in my OWN fixes — exactly its purpose.

### ✅ FIXED & deployed
- [x] **P1 (fix-incomplete) — Empty Gemini candidate after a committed booking still showed "I'm sorry, I didn't catch that"** — the per-round break (`finalText = result.text ?? "<apology>"`) set a TRUTHY apology that bypassed the post-loop `if (!finalText) resolveFinalReply(...)` guard, re-opening the iteration-1 P1 through an uncovered exit (empty candidate = MAX_TOKENS@800/SAFETY right after a successful create). **Fix:** the break now sets `finalText = result.text ?? null` and BOTH loop exits funnel through `finalText = resolveFinalReply(finalText, lastMutation)` — a committed booking can never be masked. (Now everything routes through the unit-tested resolver.)
- [x] **P1 (regression) — WhatsApp bookings sent TWO confirmations** — the dispatcher confirms in-chat (customer's language) AND the create route always fired `sendBookingConfirmation` (a 2nd English "Reply CANCEL" template). **Fix:** create body carries `channel:"whatsapp"`; the route skips its own confirmation when `channel==="whatsapp"` (web/voice still get the sole confirmation). Explicit flag, not session-prefix sniffing.

### ⬜ Confirmed, deferred (the resolveFinalReply / ordering cluster → next iteration)
- [ ] **P2 — pendingReply fast-path sits BELOW the billing/handoff gates** — a committed booking's confirmation retry is dropped if the tenant is suspended between the failed send and the retry. Fix: move the fast-path ABOVE the gates (an owed, already-committed obligation).
- [ ] **P2 — `lastMutation` tracks only the LAST mutating tool** — a successful create followed by a failed same-turn update/cancel reports the booking as failed. Fix: prefer the last SUCCESSFUL mutation.
- [ ] **P2 — Failed create on the final round sends generic "having trouble" instead of the route's `alternatives`** — `resolveFinalReply` should surface actionable failure data (fully_booked/outside_hours alternatives).
- [ ] **P2 — Draft safety-net per-session overwrite** — a 2nd booking in the same session, if it fails, is hidden because the draft was marked converted by the 1st. Fix: reset `converted` on new create-attempt fields.
- [ ] **P3 — `resolveFinalReply` + create-success confirmations are hardcoded English** — wrong language for ZH/BM/KO customers on the final-round/empty-candidate path. Fix: localized confirmation strings (or always reserve a model round to speak).

## Iteration 7 — reply-resolution + ordering cluster (2026-06-04)

### ✅ FIXED & deployed
- [x] **P2 (WA-3, fix-incomplete) — success must win over a later same-turn failure** — `lastMutation` tracked the LAST mutating tool, so a successful create followed by a failed same-turn update/cancel reported the booking as failed. **Fix:** the dispatcher now only records the last SUCCESSFUL mutation (`isMutatingTool && mutationSucceeded`), so a committed create is never masked.
- [x] **P2 (WA-2, regression) — pendingReply fast-path sat below the billing/handoff gates** — a committed booking's confirmation retry was dropped if the tenant suspended between the failed send and the retry. **Fix:** moved the fast-path ABOVE the gates — a pending confirmation is an already-committed obligation and is honored regardless of current service state.
- [x] **P2 (draft-multibooking, fix-incomplete) — per-customer draft hid a failed repeat booking** — WhatsApp sessions are `wa_<phone>` (stable per customer), so a repeat booker reuses one draft; a failed 2nd booking looked `converted` from the 1st and vanished from staff recovery. **Fix:** `upsertDraft` un-converts the draft when new booking fields arrive on an already-converted session draft (fresh intent), so a failed/incomplete follow-on stays recoverable.

### ⬜ Confirmed, still open
- [ ] **P2 (F1) — failed create on the final tool round → generic "having trouble" instead of the route's `alternatives`** — only bites on the rare empty-candidate/exhaustion-after-failed-create path (the model normally voices the failure in-language). Deferred: surfacing alternatives well is locale-dependent.
- [ ] **P3 — English fallback strings** in `resolveFinalReply` + create-success message — wrong language for ZH/BM/KO only on the rare no-model-text path. Deferred (low value; the common path is already in-language).
- [ ] **P1 — Vapi phone dead-transfer** — _needs Chris to re-import the Vapi assistant_ after I prep the `transferCall` spec.
- [ ] **P2 — reminder-cron retry/failure-marker** (once-daily `where(date==tomorrow)` → a missed reminder is permanently unrecoverable; needs a date-range query + index consideration).
- [ ] **P2 — per-inbound-message create idempotency key** (`metaMessageId`) — belt-and-braces beyond the 60-min dup guard + pendingReply fast-path.
- [ ] **P2 — remaining parity polish:** phone caller-ID discarded; cross-channel success-message wording; Vapi schema hand-fork drift; WhatsApp sender==booking-number assumption. **P3:** web proactive greeting.

## Test ledger
- 126 tests (0→126 this session): +13 `reply-resolution`, +8 `conversation`, +6 `promo-channel`, +5 `business/hours`, on top of the prior 94.
