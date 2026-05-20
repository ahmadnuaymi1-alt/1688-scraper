/**
 * Inspect Higgsfield's reference image slots to find the "remove" (X) button
 * pattern so we can clear pre-filled slots before each upload.
 */
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const URL_ = "https://higgsfield.ai/ai/image?model=nano-banana-pro";

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

  // The probe earlier found 4 file-input labels at y=571 with width 56, x=185, 249, 313, 377.
  // Around each label, look for any descendant buttons / SVGs that could be the X remove handle.
  const result = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll("label.grid.size-full"));
    return labels.slice(0, 6).map((lbl, i) => {
      const rect = lbl.getBoundingClientRect();
      // Find all images in the label (pre-filled slot will have an <img>)
      const imgs = Array.from(lbl.querySelectorAll("img")).map((img) => ({
        src: (img as HTMLImageElement).src.slice(0, 80),
        rect: img.getBoundingClientRect(),
      }));
      // Find sibling buttons near the label (the X close button is usually
      // positioned absolutely outside the label, in the parent container).
      const parent = lbl.parentElement;
      const buttons = parent ? Array.from(parent.querySelectorAll("button")).map((b) => ({
        text: (b.textContent || "").trim().slice(0, 40),
        ariaLabel: b.getAttribute("aria-label") || "",
        rect: b.getBoundingClientRect(),
        outerHTML: b.outerHTML.slice(0, 200),
      })) : [];
      // Find SVGs (close icons often rendered as SVG path inside small button)
      const svgs = parent ? Array.from(parent.querySelectorAll("svg")).map((s) => ({
        rect: s.getBoundingClientRect(),
        className: (s.getAttribute("class") || "").slice(0, 60),
      })) : [];
      return {
        index: i,
        labelRect: rect,
        imgs,
        buttonsInParent: buttons,
        svgsInParent: svgs.slice(0, 4),
      };
    });
  });
  for (const r of result) {
    console.log(`\n[#${r.index}] label @(${Math.round(r.labelRect.x)},${Math.round(r.labelRect.y)})`);
    console.log(`  imgs: ${r.imgs.length}`);
    for (const img of r.imgs) {
      console.log(`    img src=${img.src}... rect=(${Math.round(img.rect.x)},${Math.round(img.rect.y)}) ${Math.round(img.rect.width)}x${Math.round(img.rect.height)}`);
    }
    console.log(`  parent has ${r.buttonsInParent.length} button(s), ${r.svgsInParent.length} svg(s)`);
    for (const b of r.buttonsInParent.slice(0, 4)) {
      console.log(`    btn text="${b.text}" aria="${b.ariaLabel}" @(${Math.round(b.rect.x)},${Math.round(b.rect.y)}) ${Math.round(b.rect.width)}x${Math.round(b.rect.height)}`);
      console.log(`      html: ${b.outerHTML}`);
    }
  }
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
