// Diagnostic: compare wa_notification_queue vs songhwa_reservations to find orphans.
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const text = readFileSync("/Users/chrisfun/songhwa_CS_Agent/.env.local", "utf-8");
for (const line of text.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const k = line.slice(0, eq).trim();
  let v = line.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\n/g, "\n");
  if (!process.env[k]) process.env[k] = v;
}

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  }),
});
const db = getFirestore();

console.log("\n=== Last 15 wa_notification_queue items (newest first) ===");
const waSnap = await db.collection("wa_notification_queue")
  .orderBy("createdAt", "desc")
  .limit(15)
  .get();
for (const doc of waSnap.docs) {
  const d = doc.data();
  const sent = d.sentAt ? "✓SENT" : "✗QUEUED";
  const meta = d.metadata ?? {};
  console.log(`  [${sent}] ${d.createdAt} | type=${d.type} | reservationId=${meta.reservationId ?? "(none)"} | attempts=${d.attempts}`);
}

console.log("\n=== Last 15 songhwa_reservations (newest first) ===");
const resSnap = await db.collection("songhwa_reservations")
  .orderBy("createdAt", "desc")
  .limit(15)
  .get();
for (const doc of resSnap.docs) {
  const d = doc.data();
  console.log(`  ${d.createdAt} | ${d.id} | name=${d.name} | phone=${d.phone} | ${d.date} ${d.time} pax=${d.pax} | status=${d.status ?? "?"}`);
}

console.log("\n=== ORPHAN CHECK — WA queued items pointing to nonexistent reservation IDs ===");
const reservationIds = new Set(resSnap.docs.map((d) => d.data().id));
for (const doc of waSnap.docs) {
  const meta = doc.data().metadata ?? {};
  const resId = meta.reservationId;
  if (resId && !reservationIds.has(resId)) {
    console.log(`  ❌ ORPHAN: WA queued for resId=${resId} but no reservation exists. Type: ${doc.data().type}`);
  }
}

console.log("\n=== Recent reservation drafts (last 10) ===");
const draftSnap = await db.collection("songhwa_reservation_drafts")
  .orderBy("createdAt", "desc")
  .limit(10)
  .get();
for (const doc of draftSnap.docs) {
  const d = doc.data();
  console.log(`  ${d.createdAt} | session=${d.sessionId} | converted=${d.convertedToReservationId ?? "(no)"} | name=${d.name ?? "?"} phone=${d.phone ?? "?"} ${d.date ?? "?"} ${d.time ?? "?"} pax=${d.pax ?? "?"}`);
}

process.exit(0);
