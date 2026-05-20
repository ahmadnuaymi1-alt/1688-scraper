/**
 * Probe Higgsfield's file-input layout so we can tell which inputs are
 * "reference image slots" vs hidden inputs for other purposes (avatar,
 * profile, etc.). Prints per-input: index, visibility, accept, name,
 * parent label/aria, bounding box of nearest visible ancestor button.
 */
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro";

async function main() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const result = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    return inputs.map((inp, i) => {
      const rect = inp.getBoundingClientRect();
      // Walk up to find a visible ancestor with a label or aria-label
      let ancestor: HTMLElement | null = inp;
      let label = "";
      while (ancestor) {
        const aria = ancestor.getAttribute("aria-label");
        if (aria) { label = `[aria-label] ${aria}`; break; }
        const lbl = ancestor.querySelector("label");
        if (lbl && lbl.textContent) { label = `[label] ${lbl.textContent.trim().slice(0, 80)}`; break; }
        ancestor = ancestor.parentElement;
      }
      // Find the nearest visible button/parent for clicking
      let trigger: HTMLElement | null = inp.parentElement;
      let triggerInfo = "";
      while (trigger) {
        const rect2 = trigger.getBoundingClientRect();
        if (rect2.width > 5 && rect2.height > 5) {
          triggerInfo = `${trigger.tagName.toLowerCase()}.${(trigger.className || "").toString().slice(0, 60)} @(${Math.round(rect2.x)},${Math.round(rect2.y)}) ${Math.round(rect2.width)}x${Math.round(rect2.height)}`;
          break;
        }
        trigger = trigger.parentElement;
      }
      return {
        index: i,
        accept: inp.accept || "(none)",
        name: inp.name || "(none)",
        multiple: inp.multiple,
        offsetParent: inp.offsetParent ? "yes" : "no (hidden)",
        rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        label: label || "(no label)",
        triggerAncestor: triggerInfo || "(none)",
      };
    });
  });
  console.log(`\nFound ${result.length} file input(s):\n`);
  for (const r of result) {
    console.log(`  [#${r.index}] accept=${r.accept} name=${r.name} multiple=${r.multiple} offsetParent=${r.offsetParent}`);
    console.log(`           rect: ${r.rect}`);
    console.log(`           label: ${r.label}`);
    console.log(`           trigger: ${r.triggerAncestor}`);
  }
  console.log(`\nLeaving browser open for inspection. Close manually when done.`);
  await new Promise<void>((resolve) => context.on("close", () => resolve()));
}

main().catch((e) => { console.error(e); process.exit(1); });
