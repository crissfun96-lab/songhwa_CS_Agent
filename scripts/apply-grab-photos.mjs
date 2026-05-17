#!/usr/bin/env node
// Match scraped Grab photos to Firestore menu items by code → update photoUrl.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Load .env.local
function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
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

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// Parse dish code from Grab alt text
// Format: "Songhwa Korean Cuisine - Millerz Square [Non-Halal] : A1. BBQ Pork Belly"
function parseCodeFromAlt(alt) {
  const m = alt.match(/:\s*([A-Z][A-Z0-9_&]*\d+[A-Z]?)\s*\./);
  return m ? m[1] : null;
}

async function main() {
  const scrapePath = path.join(ROOT, "docs", "data", "grab-scrape-result.json");
  const scrape = JSON.parse(fs.readFileSync(scrapePath, "utf8"));
  console.log(`Loaded ${scrape.images.length} scraped images\n`);

  // Build code → photoUrl map
  const codeToUrl = new Map();
  for (const img of scrape.images) {
    const code = parseCodeFromAlt(img.alt);
    if (!code || !img.src) continue;
    // Prefer higher-res or first-seen
    if (!codeToUrl.has(code)) {
      codeToUrl.set(code, img.src);
    }
  }
  console.log(`Parsed ${codeToUrl.size} unique dish codes from Grab`);

  // Fetch active menu items (by code)
  const snap = await db.collection("songhwa_menu_items").get();
  const items = snap.docs.map((d) => d.data());

  let matched = 0;
  let skippedNoCode = 0;
  const updates = [];

  for (const item of items) {
    if (!item.code) {
      skippedNoCode++;
      continue;
    }
    const url = codeToUrl.get(item.code);
    if (!url) continue;
    updates.push({ id: item.id, code: item.code, name: item.names?.en, photoUrl: url });
    matched++;
  }

  console.log(`\nMatched ${matched} items to Grab photos.`);
  console.log(`Skipped ${skippedNoCode} items with no code (mostly sets + add-ons).\n`);

  // Write updates in batches
  const photoDocsCollection = "songhwa_dish_photos";
  let batchCount = 0;
  for (let i = 0; i < updates.length; i += 400) {
    const batch = db.batch();
    const slice = updates.slice(i, i + 400);
    for (const u of slice) {
      // Update menu item with photoUrl
      batch.update(db.collection("songhwa_menu_items").doc(u.id), {
        photoUrl: u.photoUrl,
        updatedAt: new Date().toISOString(),
      });
      // Also create a dish_photos doc (for future use)
      batch.set(db.collection(photoDocsCollection).doc(u.id), {
        dishId: u.id,
        url: u.photoUrl,
        caption: u.name,
        isHero: true,
        uploadedAt: new Date().toISOString(),
        source: "grab",
      });
    }
    await batch.commit();
    batchCount += slice.length;
  }

  console.log(`\n✓ Updated ${batchCount} items with photoUrl + wrote ${batchCount} dish_photos records`);

  // Show sample
  console.log("\nSample matches:");
  for (const u of updates.slice(0, 5)) {
    console.log(`  ${u.code} (${u.id}): ${u.name?.slice(0, 40)}`);
    console.log(`    ${u.photoUrl}`);
  }

  // Save manifest
  const manifestPath = path.join(ROOT, "docs", "data", "dish-photos-manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        appliedAt: new Date().toISOString(),
        totalMatched: matched,
        source: "grab_scrape",
        updates,
      },
      null,
      2,
    ),
  );
  console.log(`\nManifest: ${manifestPath}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Apply failed:", err);
  process.exit(1);
});
