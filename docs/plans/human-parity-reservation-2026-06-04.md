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

## Test ledger
- 107 tests (was 94): +13 `reply-resolution` (the P1 confirm-not-fail logic).
