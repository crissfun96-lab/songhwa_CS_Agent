#!/usr/bin/env node
// Remove the fake promos I seeded from the OLD system prompt (pre-Chris-confirmation).
// Chris says: no free pudding promo, no free cake promo. Purge them.

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

async function main() {
  const now = new Date().toISOString();

  // PURGE — soft-delete (isActive=false) so auditable but hidden from agent
  const promosToKill = ["birthday_cake", "free_soy_pudding"];
  for (const id of promosToKill) {
    await db.collection("songhwa_promos").doc(id).update({
      isActive: false,
      updatedAt: now,
      sourceVersion: `purge-${Date.now()}`,
    });
    console.log(`✗ Disabled promo: ${id}`);
  }

  // Keep Eatigo + Refillable Banchan — those likely real. Chris can audit in /admin/promos.

  // Revert FAQ — remove freebie claim
  await db.collection("songhwa_faqs").doc("faq_birthday").update({
    question: "Do you do birthday celebrations?",
    "answers.en":
      "We love hosting birthday groups! For large-group birthday arrangements please mention when booking — we'll do our best to make it special.",
    "answers.zh": "我们欢迎生日聚餐！大团体请预订时告知，我们会尽力配合。",
    "answers.bm": "Kami suka raya harijadi! Untuk kumpulan besar, sila maklumkan semasa tempahan.",
    keywords: ["birthday", "cake", "celebration", "生日", "hari jadi"],
    priority: 3,
    updatedAt: now,
  });
  console.log("✓ FAQ faq_birthday reworded — no freebie claim");

  // Remove voice examples I added that mentioned fake freebies
  const badExamples = ["ex_group_freebies", "ex_group_freebies_zh", "ex_birthday_freebies"];
  for (const id of badExamples) {
    try {
      await db.collection("songhwa_voice_examples").doc(id).delete();
      console.log(`✗ Deleted voice example: ${id}`);
    } catch (e) {
      console.log(`(skip ${id}: ${e.message})`);
    }
  }

  // Also remove the original ex019 that said "free cake for 4+ pax"
  try {
    await db.collection("songhwa_voice_examples").doc("ex019").delete();
    console.log("✗ Deleted ex019 (old birthday freebie claim)");
  } catch {}

  // And ex010 about banchan — keep that, banchan is standard at Korean restaurants

  // Rebuild compact summary
  const [setSnap, itemSnap, faqSnap, promoSnap] = await Promise.all([
    db.collection("songhwa_menu_sets").where("isActive", "==", true).get(),
    db.collection("songhwa_menu_items").where("isActive", "==", true).get(),
    db.collection("songhwa_faqs").where("isActive", "==", true).get(),
    db.collection("songhwa_promos").where("isActive", "==", true).get(),
  ]);

  const sets = setSnap.docs.map((d) => d.data());
  const items = itemSnap.docs.map((d) => d.data());
  const faqs = faqSnap.docs.map((d) => d.data());
  const allPromos = promoSnap.docs.map((d) => d.data());

  const klFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const lookup = Object.fromEntries(klFmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const today = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const hhmm = `${lookup.hour}:${lookup.minute}`;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dayMap[lookup.weekday] ?? 0;

  const activePromos = allPromos.filter((p) => {
    if (p.startDate > today || p.endDate < today) return false;
    if (p.daysOfWeek?.length && !p.daysOfWeek.includes(dow)) return false;
    if (p.timeWindow) {
      if (hhmm < p.timeWindow.startHhmm) return false;
      if (hhmm > p.timeWindow.endHhmm) return false;
    }
    return true;
  });

  await db.collection("songhwa_menu_cache").doc("latest").set({
    generatedAt: now,
    sets: sets
      .sort((a, b) => (a.code || "").localeCompare(b.code || ""))
      .map((s) => ({
        code: s.code,
        name: s.name,
        pax: s.paxMin === s.paxMax ? `${s.paxMin}` : `${s.paxMin}-${s.paxMax}`,
        priceRm: s.priceRm,
        flags: s.flags ?? [],
        oneLineDescription: (s.description?.en || s.name).split(".")[0] + ".",
      })),
    signatureDishes: items
      .filter((i) => i.isSignature || i.isPopular)
      .slice(0, 8)
      .map((i) => ({
        id: i.id,
        name: i.names?.en,
        priceRm: i.priceRm,
        category: i.category,
      })),
    activePromos: activePromos.map((p) => ({
      name: p.name,
      summary: p.description?.en,
      endDate: p.endDate,
    })),
    keyFaqs: faqs
      .filter((f) => f.priority <= 2)
      .slice(0, 5)
      .map((f) => ({
        question: f.question,
        answer: f.answers?.en,
      })),
  });

  console.log("\nActive promos now:", activePromos.map((p) => p.name).join(", ") || "(none)");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
