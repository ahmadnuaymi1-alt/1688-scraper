/**
 * Reusable solver for Higgsfield's "Slide right to secure your access"
 * verification widget.
 *
 * The widget renders a white card with TWO arrow buttons — a draggable handle
 * on the LEFT and a static target on the RIGHT, separated by an empty track.
 * We locate both and drag the LEFT handle to where the RIGHT button sits, with
 * eased + jittered motion so the swipe does not look robot-uniform.
 *
 * `solveHiggsfieldSlider` is the shared entry point used by both the standalone
 * `_solve-higgsfield-verification.ts` CLI and the `probe-patchright-higgsfield.ts`
 * side-probe — so there is exactly one drag implementation to maintain.
 */
import type { Page, Locator } from "@playwright/test";

type BoxedHandle = {
  handle: Locator;
  box: { x: number; y: number; width: number; height: number };
};

/** True if the "Verification Required" wall is currently on screen. */
export async function hasVerificationWall(page: Page): Promise<boolean> {
  return page
    .locator("text=Verification Required")
    .count()
    .then((c) => c > 0)
    .catch(() => false);
}

/**
 * Solve the slider if present.
 *
 * Returns true if the widget was absent (nothing to do) or was successfully
 * cleared; false if a widget was present and could not be cleared.
 */
export async function solveHiggsfieldSlider(page: Page): Promise<boolean> {
  if (!(await hasVerificationWall(page))) {
    console.log("  No verification wall present — nothing to solve.");
    return true;
  }

  console.log('  Found "Verification Required" — attempting slide solve.');

  // Take all bounding boxes of visible buttons containing "→".
  const arrowButtons = await page
    .locator('button:has-text("→"), [role="button"]:has-text("→"), div:has-text("→") >> button')
    .all();
  console.log(`  Located ${arrowButtons.length} candidate arrow elements.`);

  const boxes: BoxedHandle[] = [];
  for (const h of arrowButtons) {
    const box = await h.boundingBox().catch(() => null);
    if (!box) continue;
    if (box.width < 5 || box.height < 5) continue;
    boxes.push({ handle: h, box });
  }

  if (boxes.length < 2) {
    // Fallback: slider images sometimes render as <svg>/<img> not text. Scan
    // for small clickable squares in the captcha card area.
    console.warn("  Could not find two arrow buttons by text — trying 'small clickable square' fallback.");
    const allButtons = await page.locator('button, [role="button"]').all();
    for (const h of allButtons) {
      const box = await h.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.width < 30 || box.width > 80) continue;
      if (Math.abs(box.width - box.height) > 20) continue;
      boxes.push({ handle: h, box });
    }
  }

  // Sort by x; leftmost = draggable handle, rightmost = target.
  boxes.sort((a, b) => a.box.x - b.box.x);
  const inSameRow = (a: BoxedHandle, b: BoxedHandle) => Math.abs(a.box.y - b.box.y) < 25;

  // Find two boxes in the same horizontal row with a significant x-gap.
  let leftBox: BoxedHandle | null = null;
  let rightBox: BoxedHandle | null = null;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!inSameRow(boxes[i], boxes[j])) continue;
      if (boxes[j].box.x - boxes[i].box.x < 100) continue;
      leftBox = boxes[i];
      rightBox = boxes[j];
      break;
    }
    if (leftBox) break;
  }

  if (!leftBox || !rightBox) {
    console.error("  Could not identify the slider handle + target pair — solve it manually in the browser window.");
    return false;
  }

  const startX = leftBox.box.x + leftBox.box.width / 2;
  const startY = leftBox.box.y + leftBox.box.height / 2;
  const endX = rightBox.box.x + rightBox.box.width / 2;
  const endY = rightBox.box.y + rightBox.box.height / 2;
  console.log(
    `  Slider handle at (${startX.toFixed(0)}, ${startY.toFixed(0)}) → target (${endX.toFixed(0)}, ${endY.toFixed(0)}).`,
  );

  // Hover the handle, press down, drag in small eased + jittered steps to
  // simulate a real human swipe.
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
  console.log("  Released slider. Waiting for verification to clear...");

  // Wait up to 8s for the verification text to disappear OR for the main
  // image-gen UI to appear.
  const cleared = await Promise.race([
    page
      .locator("text=Verification Required")
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
    console.log("  ✓ Verification cleared.");
  } else {
    console.log("  ⚠ Verification widget may still be present — retry or solve manually.");
  }
  return cleared;
}
