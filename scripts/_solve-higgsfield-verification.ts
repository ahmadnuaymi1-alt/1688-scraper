/**
 * Standalone CLI to solve Higgsfield's "Slide right to secure your access"
 * verification widget on the persistent profile dir the hero/lifestyle scripts
 * use — so after this runs successfully the next lifestyle/hero run uses an
 * already-cleared session.
 *
 * The actual slide logic lives in scripts/lib/higgsfield-slider.ts and is
 * shared with scripts/probe-patchright-higgsfield.ts.
 *
 * Usage:
 *   npx tsx scripts/_solve-higgsfield-verification.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page } from "@playwright/test";
import { solveHiggsfieldSlider } from "./lib/higgsfield-slider";

chromium.use(StealthPlugin());

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const HIGGSFIELD_URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro";

async function main() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  console.log(`Launching Chrome with profile: ${SESSION_DIR}`);
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    slowMo: 150,
  });
  const page = (context.pages()[0] ?? (await context.newPage())) as Page;

  console.log(`Navigating to ${HIGGSFIELD_URL} ...`);
  await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const ok = await solveHiggsfieldSlider(page);
  if (ok) {
    console.log("Session looks clean — done.");
  } else {
    await page.screenshot({
      path: path.join(os.tmpdir(), "scene", "output", "_verification_after.png"),
      fullPage: false,
    });
  }
  console.log("(Browser left open — close manually when ready.)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
