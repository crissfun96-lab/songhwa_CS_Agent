#!/usr/bin/env node
// Extract the embedded __NEXT_DATA__ SSR payload from Grab's page.
// This has the FULL menu regardless of what's visible/lazy-loaded.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const GRAB_URL = "https://food.grab.com/my/en/restaurant/songhwa-korean-cuisine-millerz-square-non-halal-delivery/1-C6KWKE4XENCZLX";

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-MY",
    timezoneId: "Asia/Kuala_Lumpur",
  });
  const page = await context.newPage();

  console.log("Fetching Grab page...");
  await page.goto(GRAB_URL, { waitUntil: "networkidle", timeout: 40000 });

  // Extract __NEXT_DATA__ (Next.js SSR payload)
  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el ? el.textContent : null;
  });

  if (!nextData) {
    console.error("No __NEXT_DATA__ found");
    await browser.close();
    process.exit(1);
  }

  const parsed = JSON.parse(nextData);
  const outPath = path.join(ROOT, "docs", "data", "grab-ssr-raw.json");
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
  console.log(`Saved raw SSR: ${outPath} (${fs.statSync(outPath).size} bytes)`);

  // Hunt for menu items in the payload — structure varies, try common paths
  const items = [];

  function walk(node, depth = 0) {
    if (depth > 8 || !node) return;
    if (typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    // Heuristic: menu item has name + (price OR priceV2) + (image OR imageUrl OR photos)
    const hasName = typeof node.name === "string";
    const hasPrice = node.priceV2 !== undefined || node.price !== undefined || node.priceInMinorUnit !== undefined;
    const hasImage = typeof node.imgHref === "string" || typeof node.imageUrl === "string" || typeof node.imgURL === "string" || (Array.isArray(node.photos) && node.photos.length > 0);
    if (hasName && hasImage && (hasPrice || node.menuItemID || node.ID)) {
      items.push({
        id: node.ID ?? node.menuItemID ?? node.id,
        name: node.name,
        description: node.description ?? "",
        priceMinor: node.priceV2?.amountInMinor ?? node.priceInMinorUnit ?? null,
        priceText: node.priceV2?.displayAmount ?? node.priceDisplay ?? null,
        imgHref: node.imgHref ?? node.imageUrl ?? node.imgURL ?? (node.photos?.[0] ?? null),
      });
    }
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  }

  walk(parsed);

  // Dedupe by id
  const byId = new Map();
  for (const it of items) {
    if (!byId.has(it.id)) byId.set(it.id, it);
  }
  const uniqueItems = Array.from(byId.values());

  console.log(`\nExtracted ${uniqueItems.length} unique menu items from SSR payload`);
  console.log("\nSample items:");
  for (const it of uniqueItems.slice(0, 10)) {
    const priceDisp = it.priceText || (it.priceMinor ? `${(it.priceMinor / 100).toFixed(2)}` : "?");
    console.log(`  ${it.name?.slice(0, 60)} — RM ${priceDisp}`);
    console.log(`    ${it.imgHref?.slice(0, 80)}`);
  }

  const outItemsPath = path.join(ROOT, "docs", "data", "grab-items-extracted.json");
  fs.writeFileSync(outItemsPath, JSON.stringify({ extractedAt: new Date().toISOString(), count: uniqueItems.length, items: uniqueItems }, null, 2));
  console.log(`\nItems saved: ${outItemsPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
