#!/usr/bin/env node
// Update the birthday_cake promo to: free cake for any 4+ pax dine-in group.
// Rebuild compact summary cache so agent picks up the new text.
// Add voice example so the agent phrases it simply.

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

const now = new Date().toISOString();

async function main() {
  // 1. Update cake promo — drop birthday condition, keep 4+ pax + dine-in
  console.log("Updating birthday_cake → free_cake_group promo...");
  await db.collection("songhwa_promos").doc("birthday_cake").update({
    name: "Free Slice of Cake (4+ pax dine-in)",
    "description.en":
      "Complimentary slice of cake for any group of 4 or more dining in. Pairs with the free soy pudding for a complete freebie experience.",
    terms: "Dine-in only. Groups of 4 or more. One cake per booking.",
    minPax: 4,
    updatedAt: now,
    sourceVersion: `update-${Date.now()}`,
  });

  // 2. Update the birthday FAQ to mention the combined 4+ pax freebies
  console.log("Updating faq_birthday to combined message...");
  await db.collection("songhwa_faqs").doc("faq_birthday").update({
    question: "Any freebies for dine-in?",
    "answers.en":
      "Yes! Every dine-in customer gets a free soy pudding. Groups of 4 or more also get a free slice of cake. Perfect for celebrations, birthdays, or just a good meal with friends.",
    "answers.zh":
      "有的！每位堂食客人免费送豆花。4人以上还有免费蛋糕一片。生日聚餐或朋友聚会都很划算。",
    "answers.bm":
      "Ada! Setiap tetamu dine-in dapat puding soya percuma. Kumpulan 4 orang ke atas dapat kek percuma pula.",
    priority: 1,
    keywords: admin.firestore.FieldValue.arrayUnion(
      "free", "gift", "freebie", "freebies", "cake", "pudding", "complimentary",
      "percuma", "免费", "赠送",
    ),
    updatedAt: now,
  });

  // 3. Add clear voice examples
  console.log("Adding voice examples...");
  const examples = [
    {
      id: "ex_group_freebies",
      scenario: "freebies",
      language: "en",
      customerSays: "Any freebies if I come with my family?",
      idealAgentReply:
        "Yes — every dine-in customer gets a free soy pudding, and if you have 4 or more people you also get a free slice of cake. How many are you bringing?",
      reasoning:
        "Combined freebie message. Simple: pudding for all dine-in, cake added at 4+ pax. End with pivot to booking.",
      isActive: true,
      updatedAt: now,
      sourceVersion: `update-${Date.now()}`,
    },
    {
      id: "ex_group_freebies_zh",
      scenario: "freebies",
      language: "zh",
      customerSays: "有什么免费的吗？",
      idealAgentReply:
        "有哦！每位堂食客人免费送豆花，4人以上还送免费蛋糕一片。请问几位？",
      reasoning: "Chinese version — combined freebies, pivot to pax count.",
      isActive: true,
      updatedAt: now,
      sourceVersion: `update-${Date.now()}`,
    },
    {
      id: "ex_birthday_freebies",
      scenario: "birthday",
      language: "en",
      customerSays: "It's my wife's birthday, 4 of us",
      idealAgentReply:
        "Happy birthday to her! Great news — 4 pax dine-in gets you both the free soy pudding AND a free slice of cake. I'll note it as a birthday. What date and time?",
      reasoning:
        "Celebrate first, mention the upgraded combined freebies (4+ pax threshold met), capture birthday flag, move to booking.",
      isActive: true,
      updatedAt: now,
      sourceVersion: `update-${Date.now()}`,
    },
  ];

  for (const ex of examples) {
    await db.collection("songhwa_voice_examples").doc(ex.id).set(ex);
  }

  // 4. Rebuild compact summary so the new text appears in the injected prompt
  console.log("Rebuilding compact summary...");
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

  // Filter promos by today + day-of-week + time window (KL time)
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

  const summary = {
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
  };

  await db.collection("songhwa_menu_cache").doc("latest").set(summary);

  console.log("\n✓ Done");
  console.log("  Active promos:", activePromos.map((p) => p.name).join(", "));
  console.log("  FAQ updated: faq_birthday");
  console.log("  Voice examples added: 3");
  console.log("  Summary rebuilt with", summary.activePromos.length, "active promos");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
