/**
 * Inspect localStorage keys on the higgsfield page to find what's persisting
 * the reference-image slot state across page loads.
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
  await page.waitForTimeout(3500);

  const keys = await page.evaluate(() => {
    const out: { ls: { k: string; valueLen: number; valuePreview: string }[]; ss: { k: string; valueLen: number; valuePreview: string }[] } = { ls: [], ss: [] };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      const v = localStorage.getItem(k) || "";
      out.ls.push({ k, valueLen: v.length, valuePreview: v.slice(0, 200) });
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      const v = sessionStorage.getItem(k) || "";
      out.ss.push({ k, valueLen: v.length, valuePreview: v.slice(0, 200) });
    }
    return out;
  });
  console.log(`\nlocalStorage (${keys.ls.length} keys):`);
  for (const e of keys.ls) {
    console.log(`  [${e.k}] (${e.valueLen} chars) ${e.valuePreview.replace(/\s+/g, " ")}`);
  }
  console.log(`\nsessionStorage (${keys.ss.length} keys):`);
  for (const e of keys.ss) {
    console.log(`  [${e.k}] (${e.valueLen} chars) ${e.valuePreview.replace(/\s+/g, " ")}`);
  }
  await context.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
