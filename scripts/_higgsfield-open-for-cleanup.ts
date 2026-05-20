/**
 * Open Higgsfield in the Playwright persistent context so the user can
 * manually dismiss any stuck modals. Closes when the user closes the window.
 */
import path from "node:path";
import os from "node:os";
import { chromium } from "@playwright/test";

const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");
const HIGGSFIELD_URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro";

async function main() {
  console.log("Opening Higgsfield in the Playwright Chrome window...");
  console.log("Manually dismiss any modal/popup that appears, then close the browser.");
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded" });
  console.log("Browser open. Close it manually when you're done dismissing modals.");
  // Wait until the user closes the context.
  await new Promise<void>((resolve) => {
    context.on("close", () => resolve());
  });
  console.log("Browser closed. Persistent session saved. Re-run v25 now.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
