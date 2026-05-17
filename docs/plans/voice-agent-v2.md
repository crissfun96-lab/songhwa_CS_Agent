# Songhwa Voice Agent v2 — Plan B Implementation

**Status:** Active · Started 2026-04-19
**Owner:** Chris Fun · Agent: Foxie 🦊
**Goal:** Production-grade AI voice agent for Songhwa Korean Cuisine — real phone number, WhatsApp, complaint flow, staff handoff, live menu knowledge.

---

## Stack Decisions (locked)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 16 + React 19 + TS + Tailwind 4 | Already in `songhwa_CS_Agent` |
| Voice AI (primary) | Gemini 3.1 Flash Live Preview | Already wired; native audio-to-audio |
| Voice AI (fallback) | Deepgram STT → Claude Haiku 4.5 → Cartesia TTS | When Gemini preview breaks |
| Telephony | Twilio Malaysia virtual number + LiveKit Agents bridge | Bridges PSTN ↔ Gemini WebSocket |
| WhatsApp | Meta WhatsApp Business Cloud API | Malaysia's default channel |
| Database | Firestore (already set up) | Sticks with existing |
| Menu store | Firestore + Google Sheet sync | Chris edits sheet from phone |
| Staff alerts | Telegram (existing) + new Staff Console UI | Phased — Telegram for MVP |
| Observability | Firestore logs + Grafana Cloud free tier | Cheap, works |
| Deploy | Vercel (existing) | Continue |

---

## Architecture (ASCII)

```
                         CUSTOMER
                    ╱        │         ╲
              Phone call   WhatsApp   Web widget
                 │            │            │
                 ▼            ▼            ▼
           ┌─────────────────────────────────────┐
           │  LiveKit Agent Bridge (Node.js)     │
           │  - PSTN audio ↔ Gemini WebSocket    │
           │  - Session + transcript logging     │
           └──────────────┬──────────────────────┘
                          │
                          ▼
           ┌─────────────────────────────────────┐
           │  Orchestrator (Routing agent)       │
           │  classifies intent → dispatches     │
           └──┬────────┬────────┬────────┬───────┘
              │        │        │        │
              ▼        ▼        ▼        ▼
          Booking  Complaint  Info    Handoff
          Agent    Agent      Agent   Agent
              │        │        │        │
              └────────┴────┬───┴────────┘
                            │
                  tool calls + data
                            │
                            ▼
           ┌─────────────────────────────────────┐
           │  Firestore                          │
           │  - menu_items, menu_sets, promos    │
           │  - faqs, dish_photos                │
           │  - reservations, complaints         │
           │  - customer_profiles                │
           │  - call_sessions, transcripts       │
           └──────────────▲──────────────────────┘
                          │ cron every 5 min
           ┌──────────────┴──────────────────────┐
           │  Google Sheet (Chris edits)         │
           └─────────────────────────────────────┘
```

---

## Week 1 — Menu Knowledge System (95% DONE)

**Goal:** Replace hardcoded menu in prompt with live Firestore-backed data that Chris edits from a Google Sheet or admin UI. Fix availability check.

### Tasks
- [x] Save this plan doc
- [x] Create `docs/data/` + `docs/plans/` directories
- [x] Design Firestore schema + TypeScript types → `src/lib/menu/types.ts` + `src/lib/business/types.ts`
- [x] Build Google Sheet template (pre-populated from real POS export) → `docs/data/songhwa-*.csv`
- [x] Seed transformer script → `scripts/seed-from-pos.py` (POS CSV → Sheet CSVs)
- [x] Firestore CRUD layer → `src/lib/menu/firestore.ts`
- [x] Google Sheets API integration → `src/lib/menu/sheet-sync.ts`
- [x] Cron endpoint (every 5 min) → `src/app/api/menu/sync/route.ts`
- [x] Google Business Profile (Places API) sync → `src/lib/business/gbp-sync.ts` + `/api/business/sync`
- [x] Menu tool endpoints:
  - [x] `/api/menu/search` — `search_menu`
  - [x] `/api/menu/promos` — `get_active_promos`
  - [x] `/api/menu/dish` — `get_dish_details`
  - [x] `/api/menu/allergens` — `check_allergens`
  - [x] `/api/menu/config` — returns live systemPrompt + tool declarations
- [x] `/api/business/status` — `get_business_status` (are we open right now)
- [x] Availability + idempotency → `src/lib/reservations/availability.ts` + `/api/availability`
- [x] Intent capture (drafts) → `src/lib/reservations/intent.ts` + `/api/reservations/draft`
- [x] Reservation route hardening → availability check + duplicate guard + structured errors
- [x] Complaint endpoint → `/api/complaints` with ticket IDs + Telegram alerts
- [x] Callback endpoint → `/api/callbacks` with urgency-based ETAs + Telegram alerts
- [x] Vercel Cron config → `vercel.json`
- [x] Setup guide → `SETUP.md`
- [ ] **REMAINING: Wire `page.tsx`** to fetch `/api/menu/config` instead of using hardcoded prompt + hardcoded 2 tools. Needs refactor to dispatch 11 tools.
- [ ] Admin UI scaffold → `src/app/admin/menu/page.tsx`
- [ ] Chris completes SETUP.md steps (enable Places API, create Sheet, set env vars, deploy)
- [ ] First sync runs — verify Firestore populated

### Week 1 Deliverable
Agent answers menu questions from live Firestore data. Chris edits menu in Google Sheet, AI updates within 5 min. Promos auto-expire. Reservations safe (no double-booking, no duplicates, intent never lost if call drops). Complaints + callbacks captured with ticket IDs.

---

## Week 2 — Telephony + Fallback Chain

**Goal:** Real phone number. Call that number, talk to AI, hang up.

### Tasks
- [ ] Provision Twilio Malaysia virtual number (~RM 150/mo)
- [ ] Set up LiveKit Cloud account (free tier initially)
- [ ] Build LiveKit Agent worker → `apps/livekit-agent/` (new package)
- [ ] PSTN ↔ Gemini Live audio bridge
- [ ] Call session logging to Firestore
- [ ] Twilio Media Streams → LiveKit room → Gemini WebSocket
- [ ] Fallback chain: Deepgram STT + Claude Haiku + Cartesia TTS
- [ ] Health check: if Gemini Live fails twice, swap to fallback mid-call
- [ ] Call recording → Firebase Storage (with PDPA notice in greeting)
- [ ] Transcript streaming to Firestore

### Week 2 Deliverable
Customer calls Malaysian number → AI answers → reservation completes → staff gets Telegram ping.

---

## Week 3 — WhatsApp + Staff Handoff

**Goal:** WhatsApp channel live. Customer can request "talk to human" and get routed.

### Tasks
- [ ] WhatsApp Business Cloud API setup (Meta Business Manager)
- [ ] WhatsApp webhook → orchestrator → Gemini (text mode + voice notes)
- [ ] Voice note transcription via Deepgram
- [ ] AI sends dish photos on request
- [ ] Handoff agent:
  - [ ] During call: Twilio SIP forward to staff phone
  - [ ] During WhatsApp: flag conversation, alert manager, switch to human mode
  - [ ] If staff unavailable: promise callback within 15 min
- [ ] Callback queue → Firestore `callback_queue` collection
- [ ] Staff confirmation flow (manager replies in Telegram "CALLED" → closes ticket)
- [ ] Recording archive in Firebase Storage with 90-day retention

### Week 3 Deliverable
Multi-channel working. Customer can say "transfer me" and actually reach a human.

---

## Week 4 — Staff Console + Guardrails + Launch

**Goal:** Staff dashboard goes live. Guardrails prevent hallucinations. 10% traffic soft launch.

### Tasks
- [ ] Staff Console UI at `/staff`
  - [ ] Live call list with status (in-progress, waiting, resolved)
  - [ ] Transcript stream per call
  - [ ] Reservation book (today, this week)
  - [ ] Complaint tickets
  - [ ] KPIs: calls/day, conversion, CSAT, avg handle time
- [ ] Guardrails layer:
  - [ ] Pre-speech evaluator (optional, Plan C upgrade path)
  - [ ] Halal auto-disclosure trigger
  - [ ] PDPA compliance check
  - [ ] Prompt injection filter
- [ ] Cost tracking: per-call, daily budget, alert at 80%
- [ ] Rate limiting: 5 calls/hr from same number (anti-abuse)
- [ ] E2E tests via Playwright
- [ ] Soft launch: 10% of calls routed to AI
- [ ] Monitor CSAT + hallucinations for 7 days
- [ ] Full rollout

### Week 4 Deliverable
Production launch. Staff console running. KPIs flowing.

---

## Environment Variables (cumulative)

```bash
# Existing
GEMINI_API_KEY=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_STAFF_CHAT_ID=

# Week 1 additions
GOOGLE_SHEETS_API_KEY=
GOOGLE_SHEETS_SHEET_ID=            # Chris's menu sheet ID
GOOGLE_SERVICE_ACCOUNT_EMAIL=      # for Sheets read access
GOOGLE_SERVICE_ACCOUNT_KEY=
CRON_SECRET=                        # protect /api/menu/sync endpoint

# Week 2 additions
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=                # Malaysia virtual number
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_URL=
DEEPGRAM_API_KEY=                   # fallback STT
ANTHROPIC_API_KEY=                  # fallback LLM
CARTESIA_API_KEY=                   # fallback TTS

# Week 3 additions
META_WHATSAPP_TOKEN=
META_WHATSAPP_PHONE_ID=
META_WHATSAPP_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=

# Week 4 additions
GRAFANA_CLOUD_API_KEY=              # observability
```

---

## File Manifest

**New directories:**
```
songhwa_CS_Agent/
├── docs/
│   ├── plans/voice-agent-v2.md                  ← THIS FILE
│   └── data/
│       ├── songhwa-menu-template.csv
│       ├── songhwa-sets-template.csv
│       ├── songhwa-promos-template.csv
│       ├── songhwa-faq-template.csv
│       └── songhwa-examples-template.csv
├── src/
│   ├── lib/
│   │   └── menu/
│   │       ├── types.ts
│   │       ├── firestore.ts
│   │       ├── sheet-sync.ts
│   │       └── prompt-injector.ts
│   └── app/
│       ├── admin/
│       │   └── menu/page.tsx
│       └── api/
│           ├── menu/
│           │   ├── sync/route.ts
│           │   ├── search/route.ts
│           │   ├── promos/route.ts
│           │   ├── dish/route.ts
│           │   └── allergens/route.ts
│           ├── availability/route.ts
│           └── complaints/route.ts
└── apps/
    └── livekit-agent/                           ← Week 2, separate package
        ├── package.json
        ├── src/
        │   ├── worker.ts
        │   ├── gemini-bridge.ts
        │   └── fallback-chain.ts
```

---

## Critical Rules (do not violate)

1. **Never hardcode menu prices in code** — always Firestore-sourced
2. **Every AI response about price/hours/halal must cite a tool call** — no hallucination from pure prompt memory
3. **Every reservation must pass availability check** — no more accepting any slot blindly
4. **Recording requires PDPA-compliant greeting** — e.g., "Call may be recorded for quality"
5. **Every complaint gets a ticket ID** — customer hears it, can reference later
6. **Handoff must be real** — either live transfer OR scheduled callback, never "just call WhatsApp"
7. **Fallback chain is tested weekly** — not just a promise
8. **Gemini 3.1 Flash Live is PREVIEW** — treat all changes as risky, version-pin models
9. **AGENTS.md warning** — Next.js 16 has breaking changes, check `node_modules/next/dist/docs/` before writing route handlers

---

## Resume Protocol (if session restarts)

1. Read this file first
2. Check which checkboxes are unticked
3. Read `src/lib/menu/types.ts` if Week 1 started
4. Continue from first unticked item
5. Update checkboxes as work completes
