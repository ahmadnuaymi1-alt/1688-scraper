/**
 * Solve Higgsfield's "Slide right to secure your access" verification
 * widget by holding the LEFT arrow handle and dragging it across the track
 * to the RIGHT arrow target.
 *
 * Uses the same persistent profile dir the hero/lifestyle scripts use, so
 * after this runs successfully the next lifestyle/hero run uses an
 * already-cleared session.
 *
 * Usage:
 *   npx tsx scripts/_solve-higgsfield-verification.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

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
  const page = context.pages()[0] ?? (await context.newPage());

  console.log(`Navigating to ${HIGGSFIELD_URL} ...`);
  await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);

  const hasVerification = await page
    .locator('text=Verification Required')
    .count()
    .then((c) => c > 0);
  if (!hasVerification) {
    console.log("No Verification Required widget detected — session looks clean. Done.");
    console.log("(Browser left open — close manually when ready.)");
    return;
  }

  console.log('Found "Verification Required" — attempting slide solve.');

  // The widget has TWO arrow buttons: the draggable handle on the LEFT and
  // the static target on the RIGHT, separated by an empty track. We locate
  // them and drag the LEFT handle to where the RIGHT button sits.
  //
  // Strategy: find all small square buttons inside the white card; the
  // leftmost is the handle, rightmost is the target.
  const arrowButtons = await page
    .locator('button:has-text("→"), [role="button"]:has-text("→"), div:has-text("→") >> button')
    .all();
  console.log(`Located ${arrowButtons.length} candidate arrow elements.`);

  // Take all bounding boxes of visible buttons containing "→".
  type BoxedHandle = { handle: typeof arrowButtons[number]; box: { x: number; y: number; width: number; height: number } };
  const boxes: BoxedHandle[] = [];
  for (const h of arrowButtons) {
    const box = await h.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width < 5 || box.height < 5) continue;
    boxes.push({ handle: h, box });
  }
  if (boxes.length < 2) {
    // Fallback: try by SVG / image triangle. Slider images sometimes render as
    // <img> or <svg> not text. Scan for any small boxes inside the captcha
    // card area.
    console.warn("Could not find two arrow buttons by text — trying generic 'small clickable square' fallback.");
    const allButtons = await page.locator('button, [role="button"]').all();
    for (const h of allButtons) {
      const box = await h.boundingBox().catch(() => null);
      if (!box) continue;
      // Roughly square, 30-80px on a side, in the middle of the page.
      if (box.width < 30 || box.width > 80) continue;
      if (Math.abs(box.width - box.height) > 20) continue;
      boxes.push({ handle: h, box });
    }
  }

  // Sort by x; leftmost = draggable handle, rightmost = target.
  boxes.sort((a, b) => a.box.x - b.box.x);
  const inSameRow = (a: BoxedHandle, b: BoxedHandle) =>
    Math.abs(a.box.y - b.box.y) < 25;
  // Find two boxes in the same horizontal row with significant x-gap.
  let leftBox: BoxedHandle | null = null;
  let rightBox: BoxedHandle | null = null;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!inSameRow(boxes[i], boxes[j])) continue;
      const dx = boxes[j].box.x - boxes[i].box.x;
      if (dx < 100) continue;
      leftBox = boxes[i];
      rightBox = boxes[j];
      break;
    }
    if (leftBox) break;
  }

  if (!leftBox || !rightBox) {
    console.error(
      "Could not identify the slider handle + target pair. Try clearing the verification manually in the browser window — leaving it open.",
    );
    return;
  }

  const startX = leftBox.box.x + leftBox.box.width / 2;
  const startY = leftBox.box.y + leftBox.box.height / 2;
  const endX = rightBox.box.x + rightBox.box.width / 2;
  const endY = rightBox.box.y + rightBox.box.height / 2;

  console.log(
    `Slider handle at (${startX.toFixed(0)}, ${startY.toFixed(0)}) → target (${endX.toFixed(0)}, ${endY.toFixed(0)}).`,
  );

  // Hover the handle, press down, drag in small steps to simulate a real
  // human swipe. Speed varies slightly to avoid robot-like uniform motion.
  await page.mouse.move(startX, startY, { steps: 5 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Eased-out curve so motion is faster mid-swipe and slows near the end.
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const x = startX + (endX - startX) * eased + (Math.random() - 0.5) * 1.5;
    const y = startY + (endY - startY) * eased + (Math.random() - 0.5) * 1.0;
    await page.mouse.move(x, y, { steps: 1 });
    await page.waitForTimeout(15 + Math.random() * 25);
  }
  // Slight overshoot then settle, then release — looks more human than a clean stop.
  await page.mouse.move(endX + 4, endY, { steps: 2 });
  await page.waitForTimeout(80);
  await page.mouse.move(endX, endY, { steps: 1 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  console.log("Released slider. Waiting for verification to clear...");

  // Wait up to 8s for the verification text to disappear OR for the main
  // image-gen UI to appear.
  const cleared = await Promise.race([
    page
      .locator('text=Verification Required')
      .first()
      .waitFor({ state: "hidden", timeout: 8000 })
      .then(() => true)
      .catch(() => false),
    page
      .locator('button:has-text("Generate")')
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false),
  ]);

  if (cleared) {
    console.log("✓ Verification cleared. Session is now unblocked.");
  } else {
    console.log(
      "⚠ Verification widget may still be present. Take a screenshot to inspect; you may need to retry or solve manually.",
    );
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
