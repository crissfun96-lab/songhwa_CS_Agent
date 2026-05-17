#!/usr/bin/env node
// One-shot Firestore seeder — bypasses Google Sheet.
// Reads docs/data/*.csv and writes to Firestore directly using Firebase Admin.
// Run: node scripts/seed-firestore.mjs
//
// Requires .env.local with FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "docs", "data");

// ── Load .env.local manually (no dotenv dep) ──────────────────
function loadEnv() {
  const envPath = path.join(ROOT, ".env.local");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  let currentKey = null;
  let buffer = "";
  let inQuoted = false;

  for (const line of text.split("\n")) {
    if (inQuoted) {
      buffer += "\n" + line;
      if (line.endsWith('"')) {
        env[currentKey] = buffer.slice(0, -1);
        inQuoted = false;
        buffer = "";
        currentKey = null;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      env[key] = value.slice(1, -1);
    } else if (value.startsWith('"')) {
      currentKey = key;
      buffer = value.slice(1);
      inQuoted = true;
    } else {
      env[key] = value;
    }
  }
  return env;
}

const env = loadEnv();

// ── Firebase init ─────────────────────────────────────────────
if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
  console.error("Missing Firebase credentials in .env.local");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ── CSV parser (handles quoted fields with commas + newlines) ─
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (c === '"') {
        inQuotes = false;
        i++;
      } else {
        field += c;
        i++;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
      } else if (c === ",") {
        row.push(field);
        field = "";
        i++;
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i++;
      } else {
        field += c;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((v) => v && v.trim()))
    .map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) {
        obj[header[i]] = (r[i] ?? "").trim();
      }
      return obj;
    });
}

// ── Helpers ───────────────────────────────────────────────────
const toBool = (v) => {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "true" || s === "1" || s === "yes" || s === "y";
};
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const splitList = (v, sep = /[,;]/) =>
  String(v ?? "")
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);

// ── Row transformers (mirror sheet-sync.ts logic) ─────────────
const now = new Date().toISOString();
const sourceVersion = `seed-${Date.now()}`;

function transformMenuItem(row) {
  const priceRm = toNum(row.price_rm);
  const spice = toNum(row.spice_level);
  return {
    id: row.id,
    code: row.code || null,
    names: {
      en: row.name_en,
      ...(row.name_bm && { bm: row.name_bm }),
      ...(row.name_zh && { zh: row.name_zh }),
      ...(row.name_ko && { ko: row.name_ko }),
    },
    priceRm,
    category: row.category,
    portionDescription: row.portion || "",
    allergens: splitList(row.allergens),
    spiceLevel: Math.max(0, Math.min(3, spice)),
    isSignature: toBool(row.is_signature),
    isPopular: toBool(row.is_popular),
    description: {
      en: row.description_en || "",
      ...(row.description_bm && { bm: row.description_bm }),
      ...(row.description_zh && { zh: row.description_zh }),
    },
    photoUrl: null,
    tags: splitList(row.tags, /[;,]/),
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

function transformSet(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    paxMin: toNum(row.pax_min),
    paxMax: toNum(row.pax_max),
    priceRm: toNum(row.price_rm),
    includes: [],
    flags: splitList(row.flags),
    description: {
      en: row.description_en || "",
      ...(row.description_zh && { zh: row.description_zh }),
    },
    photoUrl: row.photo_url || null,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

function transformPromo(row) {
  const days = splitList(row.days_of_week).map(Number).filter((n) => n >= 0 && n <= 6);
  const timeWindow =
    row.time_window_start && row.time_window_end
      ? { startHhmm: row.time_window_start, endHhmm: row.time_window_end }
      : undefined;
  return {
    id: row.id,
    name: row.name,
    description: {
      en: row.description_en || "",
      ...(row.description_zh && { zh: row.description_zh }),
    },
    discountType: row.discount_type,
    discountValue: toNum(row.discount_value),
    appliesTo: row.applies_to,
    startDate: row.start_date,
    endDate: row.end_date,
    ...(days.length && { daysOfWeek: days }),
    ...(timeWindow && { timeWindow }),
    channels: splitList(row.channels),
    terms: row.terms || "",
    ...(row.min_pax && { minPax: toNum(row.min_pax) }),
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

function transformFaq(row) {
  return {
    id: row.id,
    category: row.category,
    question: row.question,
    answers: {
      en: row.answer_en,
      ...(row.answer_bm && { bm: row.answer_bm }),
      ...(row.answer_zh && { zh: row.answer_zh }),
    },
    keywords: splitList(row.keywords),
    priority: toNum(row.priority) || 5,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

function transformExample(row) {
  return {
    id: row.id,
    customerSays: row.customer_says,
    idealAgentReply: row.ideal_agent_reply,
    reasoning: row.reasoning || "",
    scenario: row.scenario,
    language: row.language,
    isActive: true,
    sourceVersion,
    updatedAt: now,
  };
}

// ── Batch writer (500/batch Firestore limit) ──────────────────
async function writeBatched(collection, items) {
  let count = 0;
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const item of items.slice(i, i + 400)) {
      batch.set(db.collection(collection).doc(item.id), item);
      count++;
    }
    await batch.commit();
  }
  return count;
}

// ── Compact summary generator ─────────────────────────────────
function buildCompactSummary(items, sets, faqs, promos) {
  const signatureDishes = items
    .filter((i) => i.isSignature || i.isPopular)
    .slice(0, 8)
    .map((i) => ({
      id: i.id,
      name: i.names.en,
      priceRm: i.priceRm,
      category: i.category,
    }));

  const keyFaqs = faqs
    .filter((f) => f.priority <= 2)
    .slice(0, 5)
    .map((f) => ({ question: f.question, answer: f.answers.en }));

  return {
    generatedAt: now,
    sets: sets
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((s) => ({
        code: s.code,
        name: s.name,
        pax: s.paxMin === s.paxMax ? `${s.paxMin}` : `${s.paxMin}-${s.paxMax}`,
        priceRm: s.priceRm,
        flags: s.flags,
        oneLineDescription: (s.description.en || s.name).split(".")[0] + ".",
      })),
    signatureDishes,
    activePromos: promos.map((p) => ({
      name: p.name,
      summary: p.description.en,
      endDate: p.endDate,
    })),
    keyFaqs,
  };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log("Songhwa Firestore Seeder — crissfun-f9992\n");

  const menuCsv = fs.readFileSync(path.join(DATA_DIR, "songhwa-menu.csv"), "utf8");
  const setsCsv = fs.readFileSync(path.join(DATA_DIR, "songhwa-sets.csv"), "utf8");
  const promosCsv = fs.readFileSync(path.join(DATA_DIR, "songhwa-promos.csv"), "utf8");
  const faqCsv = fs.readFileSync(path.join(DATA_DIR, "songhwa-faq.csv"), "utf8");
  const examplesCsv = fs.readFileSync(path.join(DATA_DIR, "songhwa-examples.csv"), "utf8");

  const menuItems = csvToObjects(menuCsv).map(transformMenuItem).filter((i) => i.id);
  const sets = csvToObjects(setsCsv).map(transformSet).filter((s) => s.id);
  const promos = csvToObjects(promosCsv).map(transformPromo).filter((p) => p.id);
  const faqs = csvToObjects(faqCsv).map(transformFaq).filter((f) => f.id);
  const examples = csvToObjects(examplesCsv).map(transformExample).filter((e) => e.id);

  console.log(`Parsed: ${menuItems.length} items, ${sets.length} sets, ${promos.length} promos, ${faqs.length} faqs, ${examples.length} examples`);

  console.log("Writing to Firestore...");
  const writeItems = await writeBatched("songhwa_menu_items", menuItems);
  const writeSets = await writeBatched("songhwa_menu_sets", sets);
  const writePromos = await writeBatched("songhwa_promos", promos);
  const writeFaqs = await writeBatched("songhwa_faqs", faqs);
  const writeExamples = await writeBatched("songhwa_voice_examples", examples);

  console.log("Generating compact summary...");
  const summary = buildCompactSummary(menuItems, sets, faqs, promos);
  await db.collection("songhwa_menu_cache").doc("latest").set(summary);

  const status = {
    lastSyncAt: now,
    lastSourceVersion: sourceVersion,
    itemCount: writeItems,
    setCount: writeSets,
    promoCount: writePromos,
    faqCount: writeFaqs,
    exampleCount: writeExamples,
    errors: [],
    seedSource: "local_csv",
  };
  await db.collection("songhwa_sync_status").doc("latest").set(status);

  console.log("\n✓ Firestore seeded");
  console.log(JSON.stringify(status, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
