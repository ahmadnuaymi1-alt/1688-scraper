/**
 * Visual test of the Higgsfield reference-upload flow. Screenshots the
 * composer at each step so we can SEE (not assume) what reference is attached.
 *
 * Run: npx tsx scripts/_test-higgsfield-upload.ts
 * Screenshots land in %TEMP%/scene/output/_test_step*.png
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

/** Pick a lamp variant reference image (visually distinct from the golf sim). */
function findLampImage(): string {
  const prefer = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^v1_lifestyle.*\.jpg$/i.test(f));
  if (prefer.length > 0) return path.join(OUT_DIR, prefer[0]);
  const any = fs.readdirSync(OUT_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f) && !f.startsWith("_"));
  if (any.length === 0) throw new Error(`No test image in ${OUT_DIR}`);
  return path.join(OUT_DIR, any[0]);
}

async function refSrcs(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('img[alt="object image"]')).map((i) => (i as HTMLImageElement).src),
    )
    .catch(() => [] as string[]);
}

/** List buttons whose visible text mentions upload/image, for the empty-composer case. */
async function uploadButtons(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent || "").trim())
        .filter((t) => /upload|image|add/i.test(t) && t.length < 40),
    )
    .catch(() => [] as string[]);
}

async function shoot(page: Page, name: string): Promise<void> {
  const p = path.join(OUT_DIR, `_test_${name}.png`);
  // Clip to the bottom-left composer area where references render.
  await page.screenshot({ path: p, clip: { x: 0, y: 380, width: 900, height: 520 } }).catch(async () => {
    await page.screenshot({ path: p });
  });
  console.log(`  screenshot -> ${p}`);
}

async function removeOneRef(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const img = document.querySelector('img[alt="object image"]');
      if (!img) return false;
      let scope: Element | null = img;
      for (let d = 0; d < 8 && scope; d++) {
        for (const b of Array.from(scope.querySelectorAll("button"))) {
          const dd = b.querySelector("svg path")?.getAttribute("d") || "";
          if (dd.startsWith("M3.81246")) {
            (b as HTMLButtonElement).click();
            return true;
          }
        }
        scope = scope.parentElement;
      }
      return false;
    })
    .catch(() => false);
}

async function main() {
  const lamp = findLampImage();
  console.log(`Test lamp image: ${lamp}`);
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait out Higgsfield's async restore of the account's last reference.
  await page.waitForTimeout(9000);
  console.log(`\nSTEP 0 — initial. references: ${JSON.stringify(await refSrcs(page))}`);
  await shoot(page, "0_initial");

  // Clear every reference.
  for (let i = 0; i < 14; i++) {
    if ((await refSrcs(page)).length === 0) break;
    await removeOneRef(page);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2000);
  console.log(`\nSTEP 1 — after clearing. references: ${JSON.stringify(await refSrcs(page))}`);
  console.log(`  upload-ish buttons now: ${JSON.stringify(await uploadButtons(page))}`);
  await shoot(page, "1_cleared");

  // Upload the lamp into the (now empty) composer via the file input.
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  console.log(`\nSTEP 2 — uploading lamp. file inputs available: ${n}`);
  await inputs.nth(Math.max(0, n - 1)).setInputFiles(lamp);
  await page.waitForTimeout(7000);
  const after = await refSrcs(page);
  console.log(`  references after upload: ${JSON.stringify(after)}`);
  await shoot(page, "2_after_upload");

  // Definitive proof: download the actual attached reference image so we can
  // SEE whether it's our upload or the stale golf sim.
  if (after.length > 0) {
    const dl = path.join(OUT_DIR, "_test_attached_reference.png");
    const resp = await page.request.get(after[0]);
    fs.writeFileSync(dl, await resp.body());
    console.log(`  ATTACHED REFERENCE downloaded -> ${dl}`);
  }

  console.log(`\nBrowser left open. Inspect screenshots in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
