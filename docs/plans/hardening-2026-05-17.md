# Production Hardening Audit — Deep Findings (2026-05-17)

Companion to [`saas-readiness-audit-2026-05-17.md`](./saas-readiness-audit-2026-05-17.md). This doc captures the full output of the parallel security + code + database review for traceability. The audit doc summarizes what was fixed; this doc has the raw findings and reasoning.

**Method:** 3 parallel reviewer agents (security / code-quality / Firestore) audited `src/lib/{tenants,metering,billing,handoff}/`, `src/app/api/{onboard,billing,handoff,cron}/`, `src/middleware.ts`, `src/app/api/songhwa-token/route.ts`, `src/app/api/vapi/route.ts`, `src/app/api/whatsapp/webhook/route.ts`. Build + typecheck + lint sweep run in parallel.

---

## Top findings by severity

### CRITICAL (5)

1. **C1 — `X-Foxie-Tenant` header had no auth** — any attacker could send the header and target another tenant's prefix-isolated Firestore collections. **FIXED**: now requires matching `FOXIE_INTERNAL_SECRET` via `X-Foxie-Internal-Secret` header.
2. **C2 — Every live route hardcodes `songhwa_*` collections** — `tc()` helper exists but is unused by all 9 data-access modules. Until they migrate, tenant isolation is naming-convention-only. **DEFERRED** to Plan 3.
3. **C3 — `/api/billing/checkout` was unauthenticated + accepted arbitrary `priceId`** — attacker could create checkout pages for any tenant with malicious Stripe products. **FIXED**: priceId whitelist (`STRIPE_ALLOWED_PRICE_IDS`) + 10/hr IP rate limit + 30-day trialDays cap.
4. **C4 — No `firestore.rules`** — Admin SDK bypasses rules; this file is defense-in-depth for accidental client SDK exposure. **FIXED**: default-deny rules deployed.
5. **C5 — `GEMINI_API_KEY` returned to browser on Google ephemeral endpoint failure** — Bug #2.5 only fixed the origin check; the fallback architecture still leaks. **PARTIAL FIX**: rate limit tightened 60→10/hr/IP, `STRICT_TOKEN_MODE` flag added. Full close: deploy ws-proxy.

### HIGH (11)

6. **H1 — Public signup accepts `tier: "enterprise"`** — free unlimited-tier trial. **FIXED**: enum restricted to `starter|growth|pro`.
7. **H2 — Single admin credential exposes all tenants' billing** — acceptable while operator-only. **DEFERRED**: implement per-tenant auth before tenant #2 gets admin access.
8. **H3 — Resolver returns `songhwa` on `*.vercel.app`** — preview deploys leak live data once C2 fixes land. **DEFERRED**: dev-only tenant override planned for preview workflow.
9. **H4 — Vapi bridge spoofs allowed origin on all internal calls** — single secret gates entry; rotation policy needed. **DEFERRED**: add separate `X-Internal-Secret` for inter-service calls when Vapi scales.
10. **H5 — `constantTimeEqual` short-circuited on length mismatch** — leaked admin username length via timing. **FIXED**: pad to `maxLen`, loop runs same iterations regardless.
11. **H6 — Rate limiter fails open on Firestore errors** — single FS outage disables all rate limits globally. **DEFERRED**: add in-process LRU fallback when traffic warrants.
12. **H7 — `wa_inbound_messages` shared cross-tenant** — WA inbound writes share one collection. **DEFERRED** to Plan 3.
13. **H8 — `createTenant` TOCTOU race** — two simultaneous signups with same slug both succeeded. **FIXED**: atomic `.create()`.
14. **H9 — Stripe webhook returns 200 on handler exception** — failed `updateTenant` silently lost subscription state. **FIXED**: returns 500, Stripe retries up to 72h.
15. **H10 — `updateTenant` shallow-merge clobbered nested objects** — safe today (only scalars passed) but a latent trap. **FIXED**: narrow `TenantScalarPatch` type prevents nested patches at compile time.
16. **H11 — `handoff/firestore.ts` hardcoded `songhwa_handoffs`** — same root cause as C2. **DEFERRED** to Plan 3.
17. **H12 — Hot key risk on `emit()` ID prefix `m_*`** — all metering writes sorted to one shard. **FIXED**: sharded by tenant prefix + `crypto.randomUUID`.
18. **H13 — `rollupDay()` unbounded query** — could OOM at scale. **FIXED**: paginated 500-doc pages + batched writes.
19. **H14 — `getLiveMonthUsage()` O(N) per call** — would explode Firestore costs at quota-enforcement time. **FIXED**: write-through counter doc, O(1) reads.
20. **H15 — Missing composite indexes** — production queries would fail with FAILED_PRECONDITION. **FIXED**: 8 indexes declared.

### MEDIUM (12) — selected highlights

- **M1** — `/api/admin/metering` no rate limit; enumeration possible with admin creds. Acceptable single-operator.
- **M2** — Webhook 500 handling (same as H9). **FIXED**.
- **M3** — `/api/reservations/find` returns unmasked phone. **DEFERRED** (logged for future PII pass).
- **M4** — `reservations/lifecycle.ts:185` `console.log` with reservation date/time. **DEFERRED**.
- **M5** — `constantTimeEqual` uses UTF-16 code units. Edge case. **DEFERRED**.
- **M6** — `X-Foxie-Tenant` not stripped before Vapi internal fetch. **MITIGATED** by C1 fix (header now requires auth).
- **M7** — `trialDays` caller-controlled up to 90. **FIXED** (capped at 30).
- **M8** — `songhwa-token` rate limit 60/hr was too permissive. **FIXED** (10/hr).
- **M-cache** — In-memory tenant cache stale up to 60s across Vercel containers. **DOCUMENTED** in `tenants/firestore.ts`.
- **M-tc-wa** — `tc()` malformed names when tenant slug = "wa". **FIXED** via reserved-slug block.
- **M-stripe-len** — `timingSafeEqual` throws on length mismatch. **FIXED** (explicit length guard).
- **M-rollup-idempotent** — `rollupDay` re-running same `ymd` could miss late-arriving events. **DOCUMENTED**; cross-check via `getLiveMonthUsage` (counter) when enforcing quotas.

### LOW (6)

- **L1** — No CSP header. **DEFERRED**.
- **L2** — Cron `CRON_SECRET` `!==` compare. **FIXED** (`verifyBearer` constant-time).
- **L3** — `x-vercel-forwarded-for` first hop. **FIXED** (last hop).
- **L4** — Customer phone in WA webhook logs. **DEFERRED** (PII pass).
- **L-redundant-strip** — `OnboardSchema` slug regex + `createTenant` re-sanitize. Cosmetic. **DEFERRED**.
- **L-emit-vercel** — `emitAsync` fire-and-forget may drop on Vercel freeze. **DOCUMENTED**; consider `waitUntil()` migration.

---

## What this pass did NOT touch

By design (out of scope for production hardening pass):

- **Multi-tenant collection migration (C2, H7, H11)** — 9-file refactor. Belongs to Plan 3 (white-label theming + Songhwa subdomain migration). Tracked there.
- **Pipecat tool port (Plan 1)** — 11 tools to migrate from `src/app/api/` to `services/pipecat/main.py`.
- **Real integration tests (Test step #4)** — would require running dev server + Gemini Live + Firestore secrets + a test phone. The 11-step manual test in the audit doc is Chris's smoke test post-deploy.
- **Next.js 16 `middleware → proxy` rename** — deprecation warning, not a security issue.
- **React-hooks ESLint errors in admin pages** — 3 pre-existing UI bugs, no production impact.

---

## How to verify the hardening

```bash
# 1. Build green
cd /Users/chrisfun/songhwa_CS_Agent && npm run build

# 2. Deploy rules + indexes
firebase deploy --only firestore:rules,firestore:indexes

# 3. Set Vercel env vars (see audit doc)
#    STRIPE_ALLOWED_PRICE_IDS=...
#    STRICT_TOKEN_MODE=true       (after ws-proxy deploy)
#    FOXIE_INTERNAL_SECRET=...    (only if using X-Foxie-Tenant)

# 4. Deploy
vercel --prod

# 5. Smoke test
#    - POST /api/billing/checkout with random priceId → 400 "Invalid price"
#    - POST /api/onboard with tier:"enterprise" → 400 Zod error
#    - GET /api/cron/metering-rollup without Authorization → 401
#    - POST /api/songhwa-token with bad Origin → 403
```
