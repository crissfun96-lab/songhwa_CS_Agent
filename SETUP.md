# Songhwa Voice Agent v2 — Setup Guide

Follow these steps in order. Expected time: **~30-40 minutes**.

---

## 1. Google Cloud / Firebase Setup (10 min)

### 1a. Enable Places API (New)

1. Go to https://console.cloud.google.com/apis/library/places.googleapis.com
2. Make sure you're in the **Songhwa Firebase project**
3. Click **ENABLE**
4. Wait ~30 seconds for activation

### 1b. Create API Key for Places API

1. Go to https://console.cloud.google.com/apis/credentials
2. Click **+ CREATE CREDENTIALS** → **API key**
3. Copy the key — this becomes `GOOGLE_PLACES_API_KEY`
4. Click **Edit API key** (restrict it):
   - Application restrictions: **HTTP referrers** → add `https://*.vercel.app/*` and your production domain
   - API restrictions: **Restrict key** → select **Places API (New)** only
5. Save

### 1c. Create API Key for Google Sheets (separate key, read-only)

1. Back at https://console.cloud.google.com/apis/library/sheets.googleapis.com
2. Click **ENABLE**
3. Credentials → create another API key
4. Restrict to **Google Sheets API** only
5. Copy → `GOOGLE_SHEETS_API_KEY`

---

## 2. Google Sheet Setup (10 min)

### 2a. Create the sheet

1. Go to https://sheets.google.com → create new sheet
2. Name it: **Songhwa Menu — Live Data**
3. Create **5 tabs** (rename at the bottom):
   - `menu`
   - `sets`
   - `promos`
   - `faq`
   - `examples`

### 2b. Import the seed data

For EACH tab:

1. Open the corresponding file in `docs/data/`:
   - `songhwa-menu.csv` → paste into `menu` tab
   - `songhwa-sets.csv` → paste into `sets` tab
   - `songhwa-promos.csv` → paste into `promos` tab
   - `songhwa-faq.csv` → paste into `faq` tab
   - `songhwa-examples.csv` → paste into `examples` tab

2. On Mac: open file → ⌘+A → ⌘+C → switch to Google Sheet → click cell A1 → ⌘+V → select **Split text to columns** if prompted

### 2c. Make it publicly readable (safe — no secrets in menu data)

1. Click **Share** (top right)
2. Click **Change to anyone with the link**
3. Permission: **Viewer**
4. Copy the sheet link

### 2d. Extract the Sheet ID

From a URL like:
```
https://docs.google.com/spreadsheets/d/1A2B3C4D5E6F7G8H9I0JKLMNOPQRS/edit
                                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                      This is your Sheet ID
```

Copy that ID → becomes `GOOGLE_SHEETS_SHEET_ID`.

---

## 3. Vercel Environment Variables (5 min)

Go to your Vercel dashboard → Songhwa CS Agent project → **Settings** → **Environment Variables**.

Add these (leave existing ones alone):

```
GEMINI_API_KEY                   (already set — verify)
FIREBASE_PROJECT_ID              (already set — verify)
FIREBASE_CLIENT_EMAIL            (already set — verify)
FIREBASE_PRIVATE_KEY             (already set — verify)
TELEGRAM_BOT_TOKEN               (already set — verify)
TELEGRAM_STAFF_CHAT_ID           (already set — verify)

# NEW — Menu sync
GOOGLE_SHEETS_API_KEY            (from step 1c)
GOOGLE_SHEETS_SHEET_ID           (from step 2d)
CRON_SECRET                      (generate: `openssl rand -hex 32` in terminal)

# NEW — Business profile (GBP)
GOOGLE_PLACES_API_KEY            (from step 1b)
SONGHWA_PLACE_ID                 (leave empty on first deploy — auto-resolved on first sync)
```

Apply to **Production**, **Preview**, and **Development** environments.

---

## 4. Deploy (2 min)

From the project directory:

```bash
cd /Users/chrisfun/songhwa_CS_Agent
git add -A
git commit -m "feat: menu sync + GBP + availability + complaint + callback"
git push
```

Vercel auto-deploys. Wait for the deployment to go green (~60 seconds).

---

## 5. First Sync (5 min)

### 5a. Trigger business profile sync (once)

```bash
curl -X POST https://songhwa-cs-agent.vercel.app/api/business/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Response will include `setupMessage` with the Place ID — copy it into Vercel env var `SONGHWA_PLACE_ID` and redeploy.

### 5b. Trigger menu sync

```bash
curl -X POST https://songhwa-cs-agent.vercel.app/api/menu/sync \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Check response — should show counts: `{ sync: { itemCount: 163, setCount: 8, ... } }`.

### 5c. Verify agent has live data

Open https://songhwa-cs-agent.vercel.app → tap the mic → ask:
- "What's M2?"
- "Are you open right now?"
- "How much is BBQ Pork Belly?"
- "Any promos today?"

All should return current, accurate data.

---

## 6. Vercel Cron (already configured in `vercel.json`)

No manual action needed — after deploy, these run automatically:
- **Menu sync**: every 5 minutes
- **Business profile sync**: daily at 6:00 AM KL time

You can verify at Vercel Dashboard → Crons tab.

---

## 7. Editing the Menu Going Forward

**Add a new dish:**
1. Open your Google Sheet → `menu` tab
2. Add a row with unique ID, name, price, category, allergens, etc.
3. Save. Within 5 minutes, agent knows about it.

**Change a price:**
1. Edit the `price_rm` column
2. Save. Agent picks up new price on next customer call.

**Run a promo:**
1. Go to `promos` tab
2. Add row with `start_date` + `end_date` (e.g., `2026-05-01` to `2026-05-31`)
3. Set `days_of_week` (comma-separated 0-6, e.g., `5,6` for Fri+Sat only)
4. Set `time_window_start` + `time_window_end` if it's a happy-hour promo
5. Save. Agent offers the promo only during valid window.

**Tune the agent's voice:**
1. Go to `examples` tab
2. Add a row with customer phrase + ideal reply + your reasoning
3. More examples = more accurate vibe. Chris's best waiter = 50-100 examples.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Menu data not yet synced" in prompt | Run `/api/menu/sync` manually (step 5b) |
| Agent cites wrong hours | Check GBP is up-to-date; run `/api/business/sync` |
| Agent doesn't hear new promo | Check `start_date` ≤ today and `end_date` ≥ today |
| Cron not running | Vercel Dashboard → Crons → verify 200 response |
| `Sheets API 403` | Sheet not shared "Anyone with link — Viewer" |
| `Places API 403` | API key not restricted correctly, or Places API not enabled |
| Duplicate reservations | The idempotency guard catches same-phone-same-time within 1 hour |

---

## 9. Verification Checklist

Before trusting the agent with real customers:

- [ ] Manual sync runs return `success: true`
- [ ] Agent answers "What's M2?" with RM 358 and Korean Full Course 4-5 pax
- [ ] Agent answers "Are you halal?" with honest non-halal disclosure
- [ ] Agent answers "Are you open now?" matching your current GBP status
- [ ] Making a test reservation saves to Firestore AND sends Telegram ping
- [ ] Asking "transfer me to human" triggers `request_human_callback` + ticket ID
- [ ] Filing a test complaint returns ticket ID + Telegram ping
- [ ] `/admin/menu` renders your live menu (once admin UI is built)

---

## 10. Scope Reminder (from Plan B)

Week 1 (DONE): Menu + GBP sync, tool endpoints, availability, complaint, callback.
Week 2 (NEXT): Twilio phone number, LiveKit bridge, fallback chain.
Week 3: WhatsApp channel + staff handoff routing.
Week 4: Staff console + guardrails + soft launch.

See `docs/plans/voice-agent-v2.md` for the full roadmap.
