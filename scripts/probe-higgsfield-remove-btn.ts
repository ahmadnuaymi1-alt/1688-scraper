/**
 * Upload a single file, then dump the parent container of the filled slot
 * so we can find a remove (X) button selector.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const URL_ = "https://higgsfield.ai/ai/image?model=nano-banana-pro";

async function main() {
  const REF = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
  if (!fs.existsSync(REF)) { console.error(`ref not found: ${REF}`); process.exit(1); }

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  console.log("BEFORE - input count:", await page.locator('input[type="file"]').count());
  // Upload one file via the first input
  await page.locator('input[type="file"]').first().setInputFiles(REF);
  await page.waitForTimeout(3000);
  console.log("AFTER upload - input count:", await page.locator('input[type="file"]').count());

  // Hover over slot 1 (the file we just uploaded) so any hover-revealed X button appears
  // Slot positions from prior probe: 185, 249, 313, 377 at y=571, size 56x56
  await page.mouse.move(185 + 28, 571 + 28);
  await page.waitForTimeout(500);
  await page.mouse.move(185 + 28, 571 + 28, { steps: 4 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(os.tmpdir(), "scene", "output", "_probe_hovered.png"), clip: { x: 100, y: 540, width: 480, height: 110 } });
  console.log("Hovered screenshot saved.");

  // After hover, scan ENTIRE DOM for any clickable buttons/svgs positioned near the slot row.
  const found = await page.evaluate(`(() => {
    var SLOT_Y = 571;
    var SLOT_X_MIN = 180;
    var SLOT_X_MAX = 430;
    var results = [];
    var all = document.querySelectorAll('button, svg, [role="button"], div[class*="close" i]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // Near the slot row
      var nearY = r.y >= (SLOT_Y - 20) && r.y <= (SLOT_Y + 80);
      var nearX = r.x >= (SLOT_X_MIN - 30) && r.x <= (SLOT_X_MAX + 30);
      if (!(nearY && nearX)) continue;
      results.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 80),
        ariaLabel: el.getAttribute('aria-label') || '',
        text: (el.textContent || '').trim().slice(0, 30),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        outer: el.outerHTML.slice(0, 220),
      });
    }
    return results;
  })()`);
  console.log("Clickable elements near slot row:");
  console.log(JSON.stringify(found, null, 2));

  console.log("\nLeaving open. Close manually.");
  await new Promise<void>((resolve) => context.on("close", () => resolve()));
}

main().catch((e) => { console.error(e); process.exit(1); });
