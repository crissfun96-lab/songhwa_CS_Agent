#!/usr/bin/env node
// Backfill `phoneNormalized` field on existing reservations + customers.
// Run once after deploying the phone normalization changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const env = {};
  let ck = null, buf = "", iq = false;
  for (const l of text.split("\n")) {
    if (iq) { buf += "\n" + l; if (l.endsWith('"')) { env[ck] = buf.slice(0, -1); iq = false; ck = null; buf = ""; } continue; }
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i === -1) continue;
    const k = t.slice(0, i).trim(); let v = t.slice(i + 1);
    if (v.startsWith('"') && v.endsWith('"') && v.length > 1) env[k] = v.slice(1, -1);
    else if (v.startsWith('"')) { ck = k; buf = v.slice(1); iq = true; }
    else env[k] = v;
  }
  return env;
}

const env = loadEnv();
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

function normalizePhone(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D+/g, "").replace(/^60/, "");
  return digits.startsWith("0") ? digits : "0" + digits;
}

async function main() {
  console.log("Backfilling phoneNormalized + status on reservations...");
  const resSnap = await db.collection("songhwa_reservations").get();

  let updated = 0;
  let skipped = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of resSnap.docs) {
    const data = doc.data();
    const updates = {};

    if (!data.phoneNormalized && data.phone) {
      updates.phoneNormalized = normalizePhone(data.phone);
    }
    if (!data.status) {
      updates.status = "confirmed";
    }

    if (Object.keys(updates).length > 0) {
      batch.update(doc.ref, updates);
      batchCount++;
      updated++;
      if (batchCount >= 400) {
        await batch.commit();
        console.log(`  committed batch of ${batchCount}`);
        batchCount = 0;
      }
    } else {
      skipped++;
    }
  }
  if (batchCount > 0) {
    await batch.commit();
    console.log(`  committed final batch of ${batchCount}`);
  }

  console.log(`✓ Reservations: ${updated} updated, ${skipped} already current`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
