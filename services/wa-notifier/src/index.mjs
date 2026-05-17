// Songhwa WhatsApp Notifier — Mac mini service.
// Long-running Node process that:
//   1. Maintains persistent Baileys WhatsApp session
//   2. Listens to Firestore `wa_notification_queue` via onSnapshot
//   3. Sends queued messages to the "Songhwa Reservations" WA group
//
// Run:   node src/index.mjs
// PM2:   pm2 start src/index.mjs --name songhwa-wa

import "dotenv/config";
import admin from "firebase-admin";
import { WaClient } from "./wa-client.mjs";
import { QueueListener } from "./queue-listener.mjs";

const requiredEnv = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing env: ${key}. See .env.example.`);
    process.exit(1);
  }
}

const targetGroupName = process.env.WA_TARGET_GROUP_NAME ?? "Songhwa Reservations";
// QR-scan by default (proven reliable). Set WA_PAIRING_PHONE to use 8-char code instead.
const pairingPhone = process.env.WA_PAIRING_PHONE || null;

// Init Firebase
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
console.log("✓ Firebase connected:", process.env.FIREBASE_PROJECT_ID);

// Start WA
const wa = new WaClient(targetGroupName, pairingPhone);
const listener = new QueueListener(wa);

// When WA is ready → start the Firestore listener
wa.onReady = () => {
  listener.start();
};

await wa.start();

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down...");
  listener.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
