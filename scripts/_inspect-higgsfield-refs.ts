/**
 * One-off diagnostic: inspect how Higgsfield's CURRENT image UI handles
 * reference images. Reuses the persistent logged-in session.
 *
 * It dumps the reference-related DOM BEFORE upload (to catch any stale
 * server-restored image like the golf sim), uploads a test image via the
 * file input, then dumps AGAIN so we can see exactly what an attached
 * reference looks like and how to detect / remove it.
 *
 * Run:  npx tsx scripts/_inspect-higgsfield-refs.ts
 * Leaves the browser open at the end for manual inspection.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Page } from "@playwright/test";

chromium.use(StealthPlugin());

const HIGGSFIELD_URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro";
const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const OUT_DIR = path.join(os.tmpdir(), "scene", "output");

/** Find any jpg/png in the output dir to use as a test upload. */
function findTestImage(): string {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /\.(jpe?g|png)$/i.test(f) && !f.startsWith("_"));
  if (files.length === 0) throw new Error(`No test image found in ${OUT_DIR}`);
  return path.join(OUT_DIR, files[0]);
}

/** Snapshot every img + file input + likely remove-button in the composer. */
async function snapshot(page: Page, label: string): Promise<void> {
  const data = await page.evaluate(() => {
    // All images — note src kind, size, position. rect computed inline
    // (a named helper inside evaluate breaks under tsx/esbuild keepNames).
    const imgs = Array.from(document.querySelectorAll("img")).map((img) => {
      const r = img.getBoundingClientRect();
      return {
        srcKind: img.src.slice(0, 24),
        alt: img.alt || "",
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        cls: (img.className || "").slice(0, 80),
      };
    });
    // File inputs.
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).map((inp) => ({
      accept: inp.getAttribute("accept") || "",
      cls: (inp.className || "").slice(0, 60),
      parentCls: ((inp.parentElement?.className as string) || "").slice(0, 80),
      grandparentCls: ((inp.parentElement?.parentElement?.className as string) || "").slice(0, 80),
    }));
    // Buttons whose svg path looks like an X close icon.
    const xButtons = Array.from(document.querySelectorAll("button")).flatMap((btn) => {
      const p = btn.querySelector("svg path");
      const d = p?.getAttribute("d") || "";
      const isX = d.startsWith("M3.81246") || d.startsWith("M4 4") || d.startsWith("M6 6");
      if (!isX) return [];
      const r = btn.getBoundingClientRect();
      return [{
        d: d.slice(0, 30),
        cls: (btn.className || "").slice(0, 90),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      }];
    });
    // Canvas elements (Higgsfield sometimes renders refs as canvas).
    const canvases = Array.from(document.querySelectorAll("canvas")).map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    // Elements with a background-image style (refs are sometimes div bg-images).
    const bgImages = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        const bg = getComputedStyle(el).backgroundImage;
        return bg && bg !== "none" && bg.includes("url(");
      })
      .slice(0, 30)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          bg: getComputedStyle(el).backgroundImage.slice(0, 60),
          cls: (el.className || "").toString().slice(0, 70),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        };
      });
    return { imgs, fileInputs, xButtons, canvases, bgImages };
  });
  console.log(`\n========== SNAPSHOT: ${label} ==========`);
  console.log(`file inputs (${data.fileInputs.length}):`);
  data.fileInputs.forEach((f, i) => console.log(`  [${i}] accept=${f.accept} | parent=${f.parentCls} | gp=${f.grandparentCls}`));
  console.log(`X-close buttons (${data.xButtons.length}):`);
  data.xButtons.forEach((b, i) => console.log(`  [${i}] d=${b.d} rect=${JSON.stringify(b.rect)} cls=${b.cls}`));
  console.log(`canvases (${data.canvases.length}): ${JSON.stringify(data.canvases)}`);
  console.log(`bg-image elements (${data.bgImages.length}):`);
  data.bgImages.forEach((b, i) => console.log(`  [${i}] ${b.bg} rect=${JSON.stringify(b.rect)} cls=${b.cls}`));
  console.log(`images (${data.imgs.length}) — composer-area (x<700,y<900) only:`);
  data.imgs
    .filter((im) => im.rect.x < 700 && im.rect.y < 900 && im.rect.w > 20)
    .forEach((im, i) => console.log(`  [${i}] ${im.srcKind} alt="${im.alt}" rect=${JSON.stringify(im.rect)} cls=${im.cls}`));
}

async function main() {
  const testImg = findTestImage();
  console.log(`Test image: ${testImg}`);
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  console.log(`Navigating to ${HIGGSFIELD_URL} ...`);
  await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5000);

  await snapshot(page, "BEFORE upload (look for stale golf-sim reference)");

  // Upload the test image to the last file input.
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  console.log(`\nUploading test image to file input #${count - 1} of ${count} ...`);
  await inputs.nth(Math.max(0, count - 1)).setInputFiles(testImg);
  await page.waitForTimeout(6000);

  await snapshot(page, "AFTER upload (this is what an attached reference looks like)");

  // Save full DOM for offline grepping.
  const html = await page.content();
  const dump = path.join(OUT_DIR, "_inspect-higgsfield-dom.html");
  fs.writeFileSync(dump, html);
  console.log(`\nFull DOM saved: ${dump}`);
  console.log(`\nBrowser left open — inspect the reference area manually, then close it.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
