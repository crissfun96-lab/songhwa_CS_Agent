#!/usr/bin/env node
// Apply Chris's corrections:
// 1. Refillable banchan — real for all dine-in. Set meals add free daily soup.
// 2. Eatigo — never proactively mention. If customer mentions, specific reply.

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
  // 1. Disable Refillable Side Dishes promo — it's a standing feature, not a promo.
  //    Move it to FAQ instead.
  await db.collection("songhwa_promos").doc("free_banchan").update({
    isActive: false,
    updatedAt: now,
    sourceVersion: `fix-${Date.now()}`,
  });
  console.log("✗ Disabled 'Refillable Side Dishes' promo (moved to FAQ)");

  // 2. Disable Eatigo as an active promo — Chris: don't proactively mention
  await db.collection("songhwa_promos").doc("eatigo_early_dinner").update({
    isActive: false,
    updatedAt: now,
    sourceVersion: `fix-${Date.now()}`,
  });
  console.log("✗ Disabled Eatigo promo (don't proactively mention)");

  // 3. Refine banchan FAQ — Chris's exact wording
  await db.collection("songhwa_faqs").doc("faq_banchan").set({
    id: "faq_banchan",
    category: "cultural",
    question: "What's included when I dine in?",
    answers: {
      en: "Every dine-in guest gets refillable banchan (Korean side dishes, including kimchi) and refillable corn silk tea. If you order a Lunch Set (L-series), you also get a free daily soup included.",
      zh: "每位堂食客人都可以续加韩式小菜（含泡菜）和玉米须茶。点午餐套餐（L系列）还附送当日例汤。",
      bm: "Setiap tetamu dine-in dapat banchan (lauk sampingan) dan teh jagung percuma dan boleh isi semula. Set makan tengah hari (L-series) tambah sup harian percuma.",
    },
    keywords: ["banchan", "side dish", "lunch", "tea", "soup", "complimentary", "free", "refill",
      "percuma", "minuman", "sup", "小菜", "续杯", "汤", "茶"],
    priority: 2,
    isActive: true,
    sourceVersion: `fix-${Date.now()}`,
    updatedAt: now,
  });
  console.log("✓ Updated faq_banchan with accurate 'what's included' text");

  // 4. Delete my previous ex010 about banchan (which said "free tapas") + add accurate one
  try {
    await db.collection("songhwa_voice_examples").doc("ex010").delete();
  } catch {}

  await db.collection("songhwa_voice_examples").doc("ex_banchan_included").set({
    id: "ex_banchan_included",
    scenario: "dine_in_included",
    language: "en",
    customerSays: "What comes with the meal?",
    idealAgentReply: "Every dine-in gets refillable banchan — Korean side dishes with kimchi — plus refillable corn silk tea. If you pick a Lunch Set, you also get a free daily soup. Set meals come with more sides too. Which are you thinking?",
    reasoning: "Chris confirmed rule: dine-in = banchan + tea. Lunch set adds soup. Never invent more.",
    isActive: true,
    sourceVersion: `fix-${Date.now()}`,
    updatedAt: now,
  });

  await db.collection("songhwa_voice_examples").doc("ex_eatigo_mention").set({
    id: "ex_eatigo_mention",
    scenario: "eatigo",
    language: "en",
    customerSays: "I made a booking through Eatigo",
    idealAgentReply: "Thanks — just come to the shop and speak to our staff on arrival. Your reservation is safe.",
    reasoning: "Chris's rule: don't explain Eatigo, just confirm their booking is safe and direct to speak to staff on arrival.",
    isActive: true,
    sourceVersion: `fix-${Date.now()}`,
    updatedAt: now,
  });

  await db.collection("songhwa_voice_examples").doc("ex_eatigo_mention_zh").set({
    id: "ex_eatigo_mention_zh",
    scenario: "eatigo",
    language: "zh",
    customerSays: "我用Eatigo预订了",
    idealAgentReply: "好的，您直接到店里和我们的员工说一声就可以，预订已经安排好了，请放心。",
    reasoning: "Chinese version of Eatigo handler.",
    isActive: true,
    sourceVersion: `fix-${Date.now()}`,
    updatedAt: now,
  });
  console.log("✓ Added accurate voice examples (banchan + 2 Eatigo handlers)");

  // 5. Rebuild compact summary
  const [setSnap, itemSnap, faqSnap, promoSnap] = await Promise.all([
    db.collection("songhwa_menu_sets").where("isActive", "==", true).get(),
    db.collection("songhwa_menu_items").where("isActive", "==", true).get(),
    db.collection("songhwa_faqs").where("isActive", "==", true).get(),
    db.collection("songhwa_promos").where("isActive", "==", true).get(),
  ]);

  const sets = setSnap.docs.map((d) => d.data());
  const items = itemSnap.docs.map((d) => d.data());
  const faqs = faqSnap.docs.map((d) => d.data());
  const promos = promoSnap.docs.map((d) => d.data());

  await db.collection("songhwa_menu_cache").doc("latest").set({
    generatedAt: now,
    sets: sets.sort((a, b) => (a.code || "").localeCompare(b.code || "")).map((s) => ({
      code: s.code,
      name: s.name,
      pax: s.paxMin === s.paxMax ? `${s.paxMin}` : `${s.paxMin}-${s.paxMax}`,
      priceRm: s.priceRm,
      flags: s.flags ?? [],
      oneLineDescription: (s.description?.en || s.name).split(".")[0] + ".",
    })),
    signatureDishes: items.filter((i) => i.isSignature || i.isPopular).slice(0, 8).map((i) => ({
      id: i.id, name: i.names?.en, priceRm: i.priceRm, category: i.category,
    })),
    activePromos: [], // always empty — tool-only
    keyFaqs: faqs.filter((f) => f.priority <= 2).slice(0, 5).map((f) => ({
      question: f.question,
      answer: f.answers?.en,
    })),
  });

  console.log(`\n✓ Cache rebuilt`);
  console.log(`  Active promos: ${promos.length} (none shown in prompt)`);
  console.log(`  Active promos in DB: ${promos.map(p => p.name).join(", ") || "(none)"}`);
  console.log(`  Key FAQs in prompt: ${faqs.filter(f => f.priority <= 2).length}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
