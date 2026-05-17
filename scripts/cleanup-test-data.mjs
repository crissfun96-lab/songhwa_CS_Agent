// EMERGENCY cleanup — deletes test data created by E2E test agents on 2026-05-17.
// Most importantly: deletes UNSENT WA queue items so Baileys doesn't send them.
//
// Run from project root:
//   node scripts/cleanup-test-data.mjs
// Or dry-run first:
//   DRY_RUN=1 node scripts/cleanup-test-data.mjs

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

// ── Manually load .env.local (no dotenv dep) ──
function loadEnv() {
  try {
    const text = readFileSync(".env.local", "utf-8");
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\n/g, "\n");
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.error("Failed to load .env.local:", err.message);
    process.exit(1);
  }
}

loadEnv();

const DRY_RUN = process.env.DRY_RUN === "1";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  console.error("Missing FIREBASE_* env vars after loading .env.local");
  console.error("projectId:", projectId, "email:", clientEmail, "key prefix:", privateKey?.slice(0, 40));
  process.exit(1);
}

initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
});

const db = getFirestore();

async function deleteWhere(collectionName, predicate, label, identKey) {
  let snap;
  try {
    snap = await db.collection(collectionName).get();
  } catch (err) {
    console.log(`[${collectionName}] skipped (${err.message})`);
    return 0;
  }
  const toDelete = snap.docs.filter((d) => {
    try { return predicate(d.data()); } catch { return false; }
  });
  console.log(`\n[${collectionName}] ${toDelete.length} ${label}`);
  for (const doc of toDelete) {
    const data = doc.data();
    const ident = data[identKey] ?? doc.id;
    console.log(`  ${DRY_RUN ? "[DRY]" : "[DEL]"} ${doc.id} (${identKey}=${String(ident).slice(0, 40)})`);
    if (!DRY_RUN) {
      await doc.ref.delete();
    }
  }
  return toDelete.length;
}

(async () => {
  console.log(`🦊 ${DRY_RUN ? "DRY RUN — no deletes" : "LIVE — deleting now"}`);

  let total = 0;

  // ── HIGHEST PRIORITY: unsent WA queue items (stop Baileys from sending them) ──
  total += await deleteWhere(
    "wa_notification_queue",
    (d) => {
      if (d.sentAt) return false; // already sent — can't unring the bell
      const meta = d.metadata ?? {};
      const resId = String(meta.reservationId ?? "");
      const ticketId = String(meta.ticketId ?? meta.callbackId ?? meta.complaintId ?? "");
      // Test items have either test reservation IDs (today's timestamps) or TEST prefix in metadata
      const todayPrefix = String(Math.floor(Date.now() / 1000)).slice(0, 6); // 177901 roughly
      return resId.includes("res_177") || ticketId.startsWith("TEST") || ticketId.includes("SC-260517") || ticketId.includes("CB-260517");
    },
    "UNSENT test WA queue items (priority)",
    "id",
  );

  // Reservations
  total += await deleteWhere(
    "songhwa_reservations",
    (d) => typeof d.phone === "string" && (d.phone.startsWith("+99") || d.phone.startsWith("99") || d.phone.startsWith("099")),
    "test reservations",
    "phone",
  );

  // Drafts
  total += await deleteWhere(
    "songhwa_reservation_drafts",
    (d) => typeof d.sessionId === "string" && /test|tool|sec/i.test(d.sessionId),
    "test drafts",
    "sessionId",
  );

  // Complaints
  total += await deleteWhere(
    "songhwa_complaints",
    (d) => typeof d.name === "string" && /^TEST/i.test(d.name),
    "test complaints",
    "name",
  );

  // Callbacks
  total += await deleteWhere(
    "songhwa_callbacks",
    (d) => typeof d.name === "string" && /^TEST/i.test(d.name),
    "test callbacks",
    "name",
  );

  // Customers
  total += await deleteWhere(
    "songhwa_customers",
    (d) => typeof d.phone === "string" && (d.phone.startsWith("+99") || d.phone.startsWith("99") || d.phone.startsWith("099")),
    "test customers",
    "phone",
  );

  console.log(`\n${DRY_RUN ? "[DRY RUN]" : "[LIVE]"} Total: ${total} docs ${DRY_RUN ? "would be" : "were"} deleted.`);
  process.exit(0);
})().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
