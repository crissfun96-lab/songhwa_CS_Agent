# Songhwa WhatsApp Notifier

Runs on Chris's Mac mini (always-on). Listens to Firestore `wa_notification_queue` and forwards messages to the "Songhwa Reservations" WhatsApp group via a dedicated WA Business account (+60 11-5435 8399).

## Setup (one time, ~10 minutes)

### 1. Install dependencies
```bash
cd ~/songhwa_CS_Agent/services/wa-notifier
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` and paste the **same Firebase creds** that are in the main app's `.env.local`:

```
FIREBASE_PROJECT_ID=crissfun-f9992
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@crissfun-f9992.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
WA_TARGET_GROUP_NAME=Songhwa Reservations
```

(Tip: `cat ../../.env.local | grep FIREBASE_ >> .env` to copy, then edit quotes.)

### 3. First launch — scan QR with +60 11-5435 8399
```bash
npm start
```

Open **WhatsApp on +60 11-5435 8399** → Settings → **Linked Devices** → **Link a Device** → scan the QR in your terminal.

After scan, the script will:
- Save session state to `./auth/` (auto-loaded on future runs)
- List all WA groups you're in
- Look for one named "Songhwa Reservations"

### 4. Add the bot to the staff group
From the +60 11-5435 8399 WhatsApp:
- Open the **Songhwa Reservations** group
- Add the bot number to the group (or if the number is already a member, ensure it's active)
- Restart the service: `Ctrl+C` then `npm start`

On restart, you should see:
```
✓ Target group found: Songhwa Reservations (1234567890@g.us)
```

### 5. Run as a persistent service (survives reboots)

#### Option A — PM2 (simplest)
```bash
npm install -g pm2
pm2 start src/index.mjs --name songhwa-wa
pm2 save
pm2 startup  # follow the printed command once
```

Logs: `pm2 logs songhwa-wa`

#### Option B — LaunchAgent (macOS-native)
See [docs/launchagent.md](./docs/launchagent.md) if preferred.

---

## Verification
Make a test reservation via https://songhwa-cs-agent.vercel.app — within ~2 seconds the group should receive:

```
🔔 New Reservation (AI Agent)

👤 Test Name
📞 0123456789
📅 2026-04-25 at 7:00 PM
👥 4 pax

Booked 19 Apr 2026, 10:30 PM
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "WA not ready yet" | Bot hasn't joined target group. Add to group, restart. |
| QR code expired | Just wait — it auto-refreshes. |
| Messages not sending | `pm2 logs songhwa-wa` — check errors. |
| Logged out of WA | Delete `./auth/`, run `npm start`, rescan QR. |
| High attempts count in Firestore | Check `error` field in failed queue items. |
| Mac mini reboots | PM2 restarts it automatically if `pm2 startup` was run. |

## What the queue looks like

In Firestore, collection: `wa_notification_queue`

```json
{
  "id": "wa_1713519823_k8x2",
  "type": "new_reservation",
  "message": "🔔 *New Reservation*...",
  "target": "Songhwa Reservations",
  "createdAt": "2026-04-19T14:30:00Z",
  "attempts": 1,
  "sentAt": "2026-04-19T14:30:02Z",
  "error": null
}
```

Sent items stay in Firestore for audit. Optionally, add a weekly cron to delete items older than 30 days.
