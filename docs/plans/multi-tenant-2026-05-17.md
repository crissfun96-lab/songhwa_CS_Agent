# Multi-Tenant Migration — Plan 3a + 3b Complete (2026-05-17 PM)

Companion to [`market-ready-roadmap.md`](./market-ready-roadmap.md). This doc captures what shipped in the multi-tenant + theming + Pipecat session.

---

## Plan 3a — `tc()` wiring across the data layer

**Goal:** Every data-access function accepts an optional `tenantId` parameter (defaulting to `DEFAULT_TENANT_ID = "songhwa"`). Routes resolve tenant via `resolveTenantId(request)` and pass it through. Internal callers (Vapi + WA dispatcher + Pipecat) propagate tenant context via `X-Foxie-Tenant` header authenticated with `X-Foxie-Internal-Secret`.

**Why optional + default?** Backwards compatibility. Songhwa's existing callers continue to work — `tc("songhwa", "reservations")` returns the literal `"songhwa_reservations"` already in the DB. No data migration. Zero collection renames. The default-fallback approach means a forgotten `resolveTenantId(request)` call silently routes to Songhwa rather than crashing — visible-only-once tenant #2 signs up. Coupled with the audit doc's checklist, that's an acceptable migration safety net.

### Modules updated (data-access)

- `src/lib/customers.ts` — `lookupCustomerByPhone`, `lookupCustomerByName`, `upsertCustomer` now accept `tenantId`
- `src/lib/complaints/firestore.ts` — `createComplaint`, `getRecentComplaints`
- `src/lib/callbacks/firestore.ts` — `createCallback`, `getActiveCallbacks`
- `src/lib/business/firestore.ts` — `saveBusinessInfo`, `getBusinessInfo`
- `src/lib/reservations/availability.ts` — `checkAvailability`, `findRecentDuplicate`
- `src/lib/reservations/lifecycle.ts` — `findReservationsByPhone`, `updateReservation`, `cancelReservation`
- `src/lib/reservations/intent.ts` — `upsertDraft`, `markDraftConverted`, `getUnconvertedDrafts`
- `src/lib/handoff/firestore.ts` — `createHandoff`, `resolveHandoff`, `getWaConversationMode`
- `src/lib/whatsapp/conversation.ts` — `loadHistory`, `appendMessage`, `clearHistory`
- `src/lib/whatsapp/dispatcher.ts` — `processInboundMessage`, `processInboundBatch`, internal HTTP calls forward `X-Foxie-Tenant`
- `src/lib/wa-queue.ts` — all enqueue helpers accept `{ tenantId, target }`; queue auto-resolves WA group from `tenant.notif.whatsappStaffGroup`

### Routes updated (explicit `resolveTenantId(request)`)

- `/api/reservations/route.ts` + `/api/reservations/[id]/route.ts` (incl. `verifyOwnership`)
- `/api/reservations/draft/route.ts`, `/api/reservations/find/route.ts`
- `/api/customers/route.ts`
- `/api/complaints/route.ts`, `/api/callbacks/route.ts`
- `/api/handoff/route.ts`
- `/api/availability/route.ts`
- `/api/business/status/route.ts`, `/api/business/sync/route.ts`
- `/api/whatsapp/webhook/route.ts`
- `/api/menu/config/route.ts`
- `/api/vapi/route.ts` — resolves tenant from Vapi assistant metadata OR `VAPI_TENANT_ID` env

### Internal-caller tenant propagation

- **Vapi bridge** (`/api/vapi`) — forwards `X-Foxie-Tenant` + `X-Foxie-Internal-Secret` to all 14 internal tool calls. Tenant ID source priority: `assistant.metadata.tenantId` → `VAPI_TENANT_ID` env → `DEFAULT_TENANT_ID`.
- **WA dispatcher** (`src/lib/whatsapp/dispatcher.ts`) — same pattern via `internalHeaders(tenantId)` helper.
- **Pipecat** (`services/pipecat/main.py`) — same pattern via `_internal_headers()` helper.

### Crons

- `/api/cron/wa-queue-health` — explicitly uses `DEFAULT_TENANT_ID` with a comment that multi-tenant ops would iterate `foxie_tenants`.
- `/api/cron/wa-dispatch`, `/api/cron/metering-rollup`, `/api/business/sync` — use `verifyBearer` for `CRON_SECRET` (constant-time, defense-in-depth).

---

## Plan 3b — White-label theming

**Goal:** Tenants can override branding, prompt content, and WA staff group without code changes.

### New `TenantTheme` type (`src/lib/tenants/types.ts`)

```ts
export interface TenantTheme {
  brandName?: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  ctaPrimary?: string;
  marketingTagline?: string;
}
```

Plus extended `TenantPromptOverrides`:
- `systemPromptTemplate?: string` — full white-label override of `BASE_PROMPT_TEMPLATE`

### Tenant-aware system prompt (`src/lib/menu/prompt-injector.ts`)

`buildSystemPrompt(tenantId)`:
- Reads live `business_info` doc (synced from Google Places) → falls back to `tenant.business.*` → falls back to Songhwa hardcoded
- Uses `tenant.promptOverrides.systemPromptTemplate` if provided (full white-label) — Songhwa keeps existing BASE_PROMPT_TEMPLATE by default
- Appends `tenant.promptOverrides.additionalRules` to the rendered prompt

### Tenant-aware WA staff group (`src/lib/wa-queue.ts`)

- `enqueue()` resolves target group: explicit option → `tenant.notif.whatsappStaffGroup` → "Songhwa Reservations" default
- Lazy-fetched per call (cached 60s via `getTenant()` LRU)

### NOT in scope this pass (deferred)

- **`/admin` UI tenant-awareness** — current pages have hardcoded "Songhwa" strings. Migration requires reading the tenant from `headers()` in server components + a theme provider. Tracked for Plan 3c when 2nd tenant onboards.
- **Menu collections** — `src/lib/menu/firestore.ts` still uses hardcoded `MENU_COLLECTIONS = { menuItems: "songhwa_menu_items", ... }`. The collection map has names not in `tc()`'s `CollectionName` enum (e.g. `voice_examples`, `sync_status`, `menu_cache` vs `menu_summary`). Resolving needs extending `collection.ts` first.
- **Tenant signup theme capture** — `/business/signup` doesn't yet collect logo/colors. New tenants get default theme.

---

## Plan 1 — Pipecat 14-tool port + LLM failover

**File:** `services/pipecat/main.py` (rewritten from 146 → 380 lines)

### Tool dispatcher

All 14 tools ported with the same endpoint mapping as the Vapi bridge (`src/app/api/vapi/route.ts`):

`lookup_customer`, `get_business_status`, `search_menu`, `get_dish_details`, `get_active_promos`, `check_allergens`, `check_availability`, `save_reservation_draft`, `find_reservation`, `create_reservation`, `update_reservation`, `cancel_reservation`, `file_complaint`, `request_human_callback`, `request_human_handoff`.

All HTTP calls go via `_internal_headers()` which forwards:
- `X-Foxie-Tenant: <TENANT_ID env>`
- `X-Foxie-Internal-Secret: <FOXIE_INTERNAL_SECRET env>` (if set)

### LLM provider failover

`build_llm_with_fallback()` — init-time fallback:
- Primary: Gemini 2.0 Flash (`GEMINI_API_KEY`)
- Fallback: OpenAI gpt-4o-mini (`OPENAI_API_KEY`) — only triggered if Gemini init throws

**Why init-time, not runtime?** Mid-call provider switching requires a state machine that detects per-turn LLM errors and re-routes the next call. That's a future enhancement — init-time fallback already catches the common cases (key missing, key rotated, billing quota hit at startup). For Songhwa today on Gemini Live, this is enough.

### Tool registration

The pipeline iterates `tools_decl` from `/api/menu/config` and `llm.register_function(name, handler)` for each. The handler closes over the tool name + session ID so the LLM can invoke any tool transparently.

### Requirements.txt

Added `openai` extra to `pipecat-ai`:
```
pipecat-ai[deepgram,cartesia,google,openai,silero]>=0.0.50
```

### What's NOT in scope

- Runtime LLM failover (mid-call switch) — see "Optional polish" in roadmap
- Pipecat actual deployment to Fly.io — Chris must `fly deploy services/pipecat/` with env vars set
- WS proxy retirement — `services/ws-proxy/` stays until Pipecat is live, then can be removed

---

## New env vars introduced

| Var | Required for | Purpose |
|---|---|---|
| `FOXIE_INTERNAL_SECRET` | Multi-tenant production | Required for `X-Foxie-Tenant` header to be honored. If unset, header is silently ignored and resolver falls back to subdomain. Internal callers (Vapi, WA dispatcher, Pipecat) all forward this. |
| `VAPI_TENANT_ID` | Vapi multi-tenant | Per-deployment tenant ID for the Vapi bridge. Defaults to `songhwa`. Can also be passed per-call via `assistant.metadata.tenantId`. |
| `TENANT_ID` (Pipecat) | Pipecat multi-tenant | Same role for Pipecat. Defaults to `songhwa`. |
| `OPENAI_API_KEY` (Pipecat) | LLM fallback | If set, used when Gemini init fails. |

## Verification

```bash
# 1. Build — must be green
cd /Users/chrisfun/songhwa_CS_Agent && npm run build

# 2. Smoke-test Songhwa fallback (no tenantId provided anywhere)
curl https://songhwa-cs-agent.vercel.app/api/menu/search?q=galbi  # works as before

# 3. Smoke-test tenant header (multi-tenant deployment only)
curl -H "X-Foxie-Tenant: acme" -H "X-Foxie-Internal-Secret: $SECRET" \
  https://acme.foxie-cs.com/api/menu/search?q=pizza  # would hit acme_* collections

# 4. Pipecat syntax check
python3 -m py_compile services/pipecat/main.py

# 5. Pipecat deployment (Chris)
cd services/pipecat && fly launch  # then fly secrets set ...
```

## What remains (future passes)

- **Plan 3c** — `/admin` and `/business` UI become tenant-aware (read tenant from `headers()`, theme provider, per-tenant favicon)
- **Menu migration** — extend `collection.ts` map + wire `MENU_COLLECTIONS` through `tc()`
- **Tenant signup theme upload** — `/business/signup` form captures logo + brand colors
- **Multi-tenant cron iteration** — cron jobs iterate `foxie_tenants` instead of defaulting to Songhwa
- **Runtime LLM fallback** — mid-call provider switching in Pipecat
- **WS proxy retirement** — once Pipecat is deployed and stable, remove `services/ws-proxy/`
