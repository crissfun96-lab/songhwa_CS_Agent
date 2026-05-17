#!/usr/bin/env node
// Scrape dish photos from Grab's Songhwa menu page.
// Handles JS-rendered content via Playwright + headless Chromium.

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const GRAB_URL = "https://food.grab.com/my/en/restaurant/songhwa-korean-cuisine-millerz-square-non-halal-delivery/1-C6KWKE4XENCZLX";

async function main() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-MY",
    timezoneId: "Asia/Kuala_Lumpur",
    geolocation: { latitude: 3.1073, longitude: 101.6814 }, // KL
    permissions: ["geolocation"],
  });

  const page = await context.newPage();
  console.log("Navigating to Grab...");
  await page.goto(GRAB_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Give the SPA time to hydrate
  await page.waitForTimeout(5000);

  // Try to dismiss any location/login overlay
  try {
    const close = await page.$("button[aria-label='close'], [class*='close-button']");
    if (close) await close.click({ force: true });
  } catch {}

  // Aggressive scroll: cover whole page multiple times so lazy-loaded images fire
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    // First: scroll down slowly to trigger lazy-load observers
    for (let y = 0; y < 20000; y += 400) {
      window.scrollTo(0, y);
      await pause(400);
    }
    // Then scroll back to top and all the way down again (some menus re-virtualize)
    window.scrollTo(0, 0);
    await pause(1000);
    for (let y = 0; y < 30000; y += 600) {
      window.scrollTo(0, y);
      await pause(300);
    }
    window.scrollTo(0, document.body.scrollHeight);
    await pause(2000);
  });
  await page.waitForTimeout(3000);

  // Try clicking any "show more" or category tabs that might reveal more items
  try {
    const expandButtons = await page.$$(
      "button[class*='show'], button[class*='more'], [class*='category-tab']",
    );
    for (const btn of expandButtons.slice(0, 5)) {
      try {
        await btn.click({ force: true, timeout: 1000 });
        await page.waitForTimeout(500);
      } catch {}
    }
  } catch {}
  await page.waitForTimeout(2000);

  // Grab every image that looks like a dish (from Grab CDN, not logos/icons)
  const images = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("img"));
    return all
      .map((img) => ({
        src: img.src,
        alt: img.alt || "",
        width: img.naturalWidth,
        height: img.naturalHeight,
      }))
      .filter(
        (i) =>
          i.src &&
          (i.src.includes("grab.com") || i.src.includes("grabfood")) &&
          i.width > 100 &&
          i.height > 100,
      );
  });

  // Also try to pull structured menu JSON if embedded
  const menuJson = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const s of scripts) {
      const t = s.textContent ?? "";
      if (t.includes("menuItems") || t.includes("dishes")) {
        return t.slice(0, 3000);
      }
    }
    return null;
  });

  const html = await page.content();

  console.log(`Found ${images.length} candidate images.`);

  const outPath = path.join(ROOT, "docs", "data", "grab-scrape-result.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        url: GRAB_URL,
        imageCount: images.length,
        images: images.slice(0, 100),
        menuJsonPreview: menuJson,
        htmlLength: html.length,
        titleTag: await page.title(),
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outPath}`);

  // Also save a screenshot for debugging
  const screenshotPath = path.join(ROOT, "docs", "data", "grab-scrape-screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot: ${screenshotPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Scrape failed:", err.message);
  process.exit(1);
});
