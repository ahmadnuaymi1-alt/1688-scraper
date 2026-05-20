/**
 * Take a screenshot of the live higgsfield session and dump it to disk.
 */
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const URL_ = "https://higgsfield.ai/ai/image?model=nano-banana-pro";
const OUT = path.join(os.tmpdir(), "scene", "output", "_probe_state.png");

async function main() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  // Crop to the prompt bar (bottom 30% of the viewport) so we can see the image slots clearly.
  await page.screenshot({ path: OUT, clip: { x: 100, y: 520, width: 1200, height: 380 } });
  console.log(`Saved: ${OUT}`);
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
