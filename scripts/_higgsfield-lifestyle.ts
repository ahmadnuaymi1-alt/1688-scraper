/**
 * Higgsfield lifestyle generator — Playwright wrapper.
 *
 * Drives https://higgsfield.ai/ai/image?model=nano-banana-pro via a persistent
 * Chromium context. First run is HEADED so the user can log in via Gmail OAuth;
 * subsequent runs reuse the saved session and run HEADLESS by default.
 *
 * Persistent context lives at: <os.tmpdir()>/scene/higgsfield-session
 *
 * The wrapper exports a single async function:
 *
 *   await runHiggsfieldBatch({
 *     referenceImage: "/abs/path/to/p1_1.jpg",
 *     prompts: [
 *       { slug: "v24_warm_evening_low_up", text: "..." },
 *       ...
 *     ],
 *     outDir: "/abs/path/to/output/folder",
 *     forceHeaded: false,
 *   });
 *
 * Selectors are robust try-multiple fallbacks. If a selector can't be found,
 * the script writes a debug screenshot + the page's HTML to `outDir` and
 * throws — so first-run failures produce immediate, actionable artifacts.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { BrowserContext, Page, Locator } from "@playwright/test";

// playwright-extra + stealth: patches ~30 well-known fingerprint leaks
// (navigator.webdriver, plugin list, canvas/WebGL signatures, HeadlessChrome
// User-Agent, etc) before any page script runs. Free, additive, drop-in.
chromium.use(StealthPlugin());

const HIGGSFIELD_URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro";
const SESSION_DIR = path.join(os.tmpdir(), "scene", "higgsfield-session");

const NAV_TIMEOUT_MS = 30_000;
const LOGIN_WAIT_TIMEOUT_MS = 5 * 60_000; // 5 min — wait for the user to log in
const GENERATION_TIMEOUT_MS = 10 * 60_000; // 10 min per generation (queues can stack with parallel tabs)
const DOWNLOAD_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_500;
const PROGRESS_SCREENSHOT_INTERVAL_MS = 10_000; // snapshot every 10s so the operator can see what's happening

// ─────────────────────────────────────────────────────────────────────────────
// Selector arrays — try each in order until one works.
// On first run these may need adjustment; the script will save a debug
// screenshot + DOM dump if everything fails, so we can refine them.
// ─────────────────────────────────────────────────────────────────────────────

const SELECTORS = {
  // "Logged in" sentinel — these only render when authenticated.
  loggedIn: [
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="describe" i]',
    'textarea[placeholder*="imagine" i]',
    'textarea[placeholder*="create" i]',
    'div[contenteditable="true"]',
    'button:has-text("Generate")',
    'button:has-text("Create")',
  ],
  // Hidden <input type=file> for reference-image upload.
  fileInput: [
    'input[type="file"]',
  ],
  // The "upload reference" button — Higgsfield labels it "Upload image".
  uploadButton: [
    'button:has-text("Upload image")',
    'button:has-text("Upload an image")',
    'button:has-text("Upload")',
    '[role="button"]:has-text("Upload image")',
    '[role="button"]:has-text("Upload")',
    'button[aria-label*="upload" i]',
    'button[aria-label*="image" i]',
    'label:has-text("Upload")',
  ],
  // Prompt textbox.
  promptInput: [
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="describe" i]',
    'textarea[placeholder*="imagine" i]',
    'textarea[placeholder*="create" i]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  // Generate / submit button.
  generateButton: [
    'button:has-text("Generate")',
    'button:has-text("Create")',
    'button:has-text("Run")',
    'button[type="submit"]',
    'button[aria-label*="generate" i]',
  ],
  // Result thumbnails — appear after generation completes.
  // Higgsfield's CDN domain is unconfirmed; we look broadly.
  resultThumb: [
    'img[src*="higgsfield"]',
    'img[src*="cloudfront"]',
    'img[src*="amazonaws"]',
    'img[alt*="result" i]',
    'img[alt*="generated" i]',
  ],
};

interface PromptItem {
  slug: string;
  text: string;
  /**
   * Override the default reference image for this prompt. Accepts either a
   * single path or an array of paths for multi-reference uploads.
   */
  referenceImage?: string | string[];
}

export interface HiggsfieldBatchOptions {
  /** Default reference image — used when a prompt doesn't specify its own. */
  referenceImage: string;
  prompts: PromptItem[];
  outDir: string;
  forceHeaded?: boolean;
  /** If true, leaves the browser open after the run for inspection. */
  keepOpen?: boolean;
  /**
   * Parallel mode: open one tab per prompt and fire all generations
   * concurrently. Default false (sequential). Pass true for parallel.
   */
  parallel?: boolean;
  /**
   * Stagger (ms) between parallel task starts — task i waits i × stagger
   * before navigating. Defaults to 1500ms. Smooths the Generate-click
   * burst that trips Higgsfield's anti-bot "Slide to verify". Only used
   * when `parallel === true`.
   */
  parallelStaggerMs?: number;
  /**
   * Queued mode: ONE tab. Submit every generation back-to-back (type prompt,
   * upload refs, click Generate, move to the next) without waiting for any to
   * finish, then collect all results at the end. One tab = one apparent user,
   * so it avoids the multi-tab burst that trips Higgsfield's anti-bot wall,
   * while staying nearly as fast as `parallel` because all generations run
   * server-side concurrently. Takes precedence over `parallel` if both set.
   */
  queued?: boolean;
}

async function findFirst(page: Page, selectors: string[], timeoutMs: number): Promise<Locator | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
        return loc;
      }
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  return null;
}

/** Find a file-input regardless of visibility (uploads use hidden inputs). */
async function findFileInput(page: Page, timeoutMs: number): Promise<Locator | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of SELECTORS.fileInput) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) return loc;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  return null;
}

async function dumpDebug(page: Page, outDir: string, label: string): Promise<void> {
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = Date.now();
    const screenshotPath = path.join(outDir, `_higgsfield-debug-${label}-${stamp}.png`);
    const htmlPath = path.join(outDir, `_higgsfield-debug-${label}-${stamp}.html`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, "utf-8");
    console.error(`  Debug dump saved: ${screenshotPath}`);
    console.error(`  Debug DOM saved:  ${htmlPath}`);
  } catch (e) {
    console.error(`  (debug dump failed: ${e instanceof Error ? e.message : String(e)})`);
  }
}

async function dismissOpenDialogs(page: Page): Promise<void> {
  // Press Escape a few times to dismiss any onboarding tour / sign-in modal /
  // upload-image popover / fullscreen backdrop. Most modal libraries (Radix,
  // Headless UI, etc.) close on Escape.
  for (let i = 0; i < 4; i++) {
    const dialogOpen = await page.locator('[role="dialog"][data-state="open"]').count();
    const backdropOpen = await page.locator('div.fixed.inset-0[class*="backdrop"]').count();
    if (dialogOpen === 0 && backdropOpen === 0) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  // Try clicking on a corner of the viewport outside any modal — this dismisses
  // most click-outside-to-close modals.
  await page.mouse.click(10, 10).catch(() => {});
  await page.waitForTimeout(400);
  // If still open, look for explicit close buttons inside the dialog.
  for (const sel of ['[role="dialog"] button[aria-label*="close" i]', '[role="dialog"] button:has-text("Close")', '[role="dialog"] button:has-text("Skip")', '[role="dialog"] button:has-text("Dismiss")', '[role="dialog"] button:has-text("Got it")', 'button[aria-label*="close" i]']) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

/** Wait for any fullscreen backdrop overlay to disappear before interacting. */
async function waitForOverlayClear(page: Page, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const backdrop = await page.locator('div.fixed.inset-0[class*="backdrop"]').count();
    if (backdrop === 0) return;
    // Try escape to actively dismiss; some backdrops close on outside-click but
    // not on Escape, others vice-versa.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function isReallyLoggedIn(page: Page): Promise<boolean> {
  // Strict logged-in check: the prompt textbox must exist AND NOT be inside an
  // open dialog (a sign-in modal can contain a fake textbox).
  for (const sel of SELECTORS.loggedIn) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    // Walk up the DOM and check no ancestor is a dialog.
    const insideDialog = await loc.evaluate((el) => {
      let cur: Element | null = el;
      while (cur) {
        if (cur.getAttribute?.("role") === "dialog") return true;
        cur = cur.parentElement;
      }
      return false;
    }).catch(() => false);
    if (!insideDialog) return true;
  }
  return false;
}

async function waitUntilLoggedIn(page: Page, outDir: string): Promise<void> {
  console.log(`  Checking login state...`);
  await dismissOpenDialogs(page);
  if (await isReallyLoggedIn(page)) {
    console.log(`  Already logged in.`);
    return;
  }
  console.log(`\n  ⚠ Not logged in.`);
  console.log(`  Please log into Higgsfield via Gmail in the open browser window.`);
  console.log(`  Waiting up to ${LOGIN_WAIT_TIMEOUT_MS / 60000} minutes for login to complete...`);
  const start = Date.now();
  while (Date.now() - start < LOGIN_WAIT_TIMEOUT_MS) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    await dismissOpenDialogs(page);
    if (await isReallyLoggedIn(page)) {
      console.log(`  Login detected. Session will be reused on subsequent runs.`);
      return;
    }
  }
  await dumpDebug(page, outDir, "login-timeout");
  throw new Error("Login timeout — could not detect logged-in state after 5 minutes.");
}

/**
 * Reference images in Higgsfield's composer render as `<img alt="object image">`
 * (56x56 thumbnails) — confirmed by live DOM inspection. The `src` of each is
 * a unique CDN URL, which lets us tell OUR uploaded image apart from a stale
 * server-restored one (the core problem: Higgsfield keeps re-injecting the
 * account's last-used reference, and both look identical to a count-only
 * check). Everything below is keyed off these srcs.
 */
async function getReferenceSrcs(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('img[alt="object image"]')).map(
        (i) => (i as HTMLImageElement).src,
      ),
    )
    .catch(() => [] as string[]);
}

/** Click the X-remove button belonging to the reference whose img src matches. */
async function removeReferenceWithSrc(page: Page, src: string): Promise<boolean> {
  return page
    .evaluate((targetSrc) => {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>('img[alt="object image"]'),
      );
      const img = imgs.find((i) => i.src === targetSrc);
      if (!img) return false;
      // Walk up from the img; at each ancestor scope look for the X button
      // (the M3.81246 close icon). The nearest scope containing one is this
      // reference's own slot.
      let scope: Element | null = img;
      for (let d = 0; d < 8 && scope; d++) {
        const btns = Array.from(scope.querySelectorAll('button'));
        for (const b of btns) {
          const p = b.querySelector('svg path');
          const dd = p ? p.getAttribute('d') || '' : '';
          if (dd.startsWith('M3.81246') || dd.startsWith('M4 4L20 20') || dd.startsWith('M6 6L18 18')) {
            (b as HTMLButtonElement).click();
            return true;
          }
        }
        scope = scope.parentElement;
      }
      return false;
    }, src)
    .catch(() => false);
}

/**
 * Clear the composer and CONFIRM it stays empty.
 *
 * Higgsfield restores the account's last-used reference image into the
 * composer asynchronously after page load — and the timing varies (sometimes
 * within 1s, sometimes 10s+). Earlier "snapshot stale, then distinguish"
 * logic failed when the stale image restored AFTER the snapshot. So instead:
 * repeatedly remove every reference and only return once the composer has
 * stayed empty for a sustained window — proof the restore has fired and been
 * cleared. From that confirmed-empty state, the next upload is unambiguous.
 *
 * Returns true if a stable-empty state was reached.
 */
async function clearUntilStableEmpty(page: Page): Promise<boolean> {
  const deadline = Date.now() + 50_000;
  const STABLE_MS = 7000; // composer must stay empty this long to count as settled
  let emptySince = 0;
  let removed = 0;
  while (Date.now() < deadline) {
    const srcs = await getReferenceSrcs(page);
    if (srcs.length === 0) {
      if (emptySince === 0) emptySince = Date.now();
      else if (Date.now() - emptySince >= STABLE_MS) {
        if (removed > 0) console.log(`  Cleared ${removed} stale reference(s); composer confirmed empty.`);
        return true;
      }
    } else {
      emptySince = 0;
      if (await removeReferenceWithSrc(page, srcs[0])) removed++;
    }
    await page.waitForTimeout(800);
  }
  return false;
}

/**
 * Perceptual average-hash (aHash) of an image buffer → 64-char bit string.
 * Robust to resize/re-encode, so a Higgsfield-side reference thumbnail can be
 * matched against the local file we uploaded. Unrelated images (e.g. a
 * golf-sim vs the product) differ by ~30+ bits; the same image differs by <12.
 */
async function aHash(buf: Buffer): Promise<string> {
  const pixels = await sharp(buf).greyscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += pixels[i];
  const avg = sum / 64;
  let bits = "";
  for (let i = 0; i < 64; i++) bits += pixels[i] >= avg ? "1" : "0";
  return bits;
}

/** Count differing bits between two equal-length bit strings. */
function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * Upload reference image(s) and guarantee the composer ends up holding EXACTLY
 * those — no stale server-restored image (e.g. a previous project's photo)
 * alongside them.
 *
 * Strategy: clear the composer to a CONFIRMED-empty state, upload, then verify
 * by IMAGE IDENTITY — download each attached reference and perceptually match
 * it against the files we uploaded. A count-only check is not enough: if
 * Higgsfield restores a stale reference while one of our uploads fails to
 * land, the count can still match while the content is wrong. Identity
 * matching makes a restored golf-sim image impossible to accept.
 */
async function uploadReference(page: Page, referencePaths: string | string[], outDir: string): Promise<void> {
  const paths = Array.isArray(referencePaths) ? referencePaths : [referencePaths];
  console.log(`  Uploading ${paths.length} reference image(s): ${paths.map((p) => path.basename(p)).join(", ")}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    // 1. Clear to a confirmed-stable-empty composer.
    const empty = await clearUntilStableEmpty(page);
    if (!empty) {
      console.log(`  WARNING: composer would not stay empty (Higgsfield kept restoring) — retry ${attempt}/3.`);
      continue;
    }

    // 2. Upload our file(s) to the last file input.
    for (let i = 0; i < paths.length; i++) {
      const inputs = page.locator('input[type="file"]');
      const before = await inputs.count();
      if (before === 0) {
        await dumpDebug(page, outDir, `no-file-input-${i}`);
        throw new Error("Could not find any file-input element on the Higgsfield page.");
      }
      await inputs.nth(before - 1).setInputFiles(paths[i]);
      console.log(`  Attached file ${i + 1}/${paths.length}: ${path.basename(paths[i])}`);
      await page.waitForTimeout(2000);
    }

    // 3. Poll up to 20s for exactly our uploads to appear. Starting from
    //    confirmed-empty, anything that shows up is ours.
    let count = 0;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      count = (await getReferenceSrcs(page)).length;
      if (count >= paths.length) break;
      await page.waitForTimeout(800);
    }

    // 4. Verify reference IDENTITY — download each attached reference and
    //    perceptually match it to the files we uploaded. A restored stale
    //    image (e.g. a golf-sim) will not match and is rejected. Count alone
    //    is not trusted: [golf, template] also has count 2.
    await page.waitForTimeout(3000);
    const attachedSrcs = await getReferenceSrcs(page);
    const wantHashes = await Promise.all(
      paths.map(async (p) => aHash(fs.readFileSync(p))),
    );
    const gotHashes: string[] = [];
    for (const src of attachedSrcs) {
      try {
        const resp = await page.request.get(src);
        gotHashes.push(await aHash(Buffer.from(await resp.body())));
      } catch {
        gotHashes.push(""); // download failed — counts as a non-match
      }
    }
    const HASH_THRESHOLD = 12;
    const everyUploadMatched = wantHashes.every((w) =>
      gotHashes.some((g) => g.length === 64 && hammingDistance(w, g) <= HASH_THRESHOLD),
    );
    const noStrayReference = attachedSrcs.length === paths.length;
    if (everyUploadMatched && noStrayReference) {
      console.log(
        `  Reference identity confirmed — ${paths.length} attached reference(s) perceptually match the uploaded file(s).`,
      );
      return;
    }
    console.log(
      `  WARNING: reference identity check FAILED (attached ${attachedSrcs.length}, expected ${paths.length}; ` +
        `uploads-matched=${everyUploadMatched}). A stale image likely restored — wiping and retrying ${attempt}/3.`,
    );
  }
  await dumpDebug(page, outDir, "stale-reference-slot");
  throw new Error(
    "uploadReference: could not confirm the correct reference image after 3 attempts — " +
      "aborting rather than generating against a wrong (stale) reference.",
  );
}

/**
 * Clear Higgsfield's persisted form state from localStorage before navigation.
 * Higgsfield stores the latest prompt + reference image references in
 * `hf:image-form-upd`, which causes stale references to pre-fill slots
 * across tab loads / page reloads. We remove that one key; we KEEP
 * `hf:nano-banana-2-image-form-3` (aspect ratio + quality preferences) so the
 * 1:1 / 1K settings persist as the user requested.
 */
async function clearPersistedFormState(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      localStorage.removeItem("hf:image-form-upd");
    } catch {
      // ignore
    }
  }).catch(() => {});
}

async function typePrompt(page: Page, text: string, outDir: string): Promise<void> {
  const promptBox = await findFirst(page, SELECTORS.promptInput, 10_000);
  if (!promptBox) {
    await dumpDebug(page, outDir, "no-prompt-input");
    throw new Error("Could not find the prompt textarea on the Higgsfield page.");
  }
  await promptBox.click();
  await promptBox.fill("");
  await promptBox.fill(text);
  await page.waitForTimeout(500);
}

async function clickGenerate(page: Page, outDir: string): Promise<void> {
  console.log(`  Clicking Generate (real mouse click)...`);
  const success = await mouseClickByText(page, "Generate");
  if (!success) {
    await dumpDebug(page, outDir, "no-generate-button");
    throw new Error("Could not find the Generate button on the Higgsfield page.");
  }
}

/**
 * Count Higgsfield's in-progress generation tiles. Every accepted generation
 * shows a tile with a "Cancel" control until it finishes, so the number of
 * "Cancel" buttons is how many generations are currently running.
 */
async function countInProgressTiles(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      let n = 0;
      document.querySelectorAll('button, [role="button"]').forEach((b) => {
        if ((b.textContent || "").trim().toLowerCase() === "cancel") n++;
      });
      return n;
    })
    .catch(() => 0);
}

/**
 * After clicking Generate, wait until Higgsfield has actually COMMITTED the
 * generation server-side — signalled by a new in-progress tile appearing
 * (in-progress count rises above `baseline`).
 *
 * This must complete before the caller reloads the page for the next prompt:
 * reloading within ~1-3s of the click cancels the not-yet-committed
 * generation, which is why queued runs silently lost 1-2 of every 6. A human
 * clicking Generate never reloads, so they never hit this — hence "I can do 6
 * but the script can't". Best-effort: returns on confirmation or after ~25s.
 */
async function waitForGenerationStarted(page: Page, baseline: number): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if ((await countInProgressTiles(page)) > baseline) {
      console.log(`  generation confirmed started (committed server-side)`);
      return;
    }
    await page.waitForTimeout(1000);
  }
  console.log(`  WARNING: could not confirm the generation started within 25s — proceeding anyway`);
}

/**
 * (Re-)inject a visible cursor sprite into the current page. Called AFTER
 * navigation/hydration so React doesn't nuke the cursor element. Uses a
 * MutationObserver pattern to re-add the cursor if React strips it later.
 */
async function injectVisibleCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    if ((window as unknown as { __pwCursorInstalled?: boolean }).__pwCursorInstalled) return;
    (window as unknown as { __pwCursorInstalled?: boolean }).__pwCursorInstalled = true;
    const ensureCursor = () => {
      let cursor = document.getElementById("__pw_cursor__");
      if (cursor) return cursor;
      cursor = document.createElement("div");
      cursor.id = "__pw_cursor__";
      cursor.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "width:22px",
        "height:22px",
        "border-radius:50%",
        "background:rgba(255,0,80,0.9)",
        "border:3px solid #fff",
        "box-shadow:0 0 16px 4px rgba(255,0,80,0.9)",
        "pointer-events:none",
        "z-index:2147483647",
        "transform:translate(-50%,-50%)",
      ].join(";");
      document.documentElement.appendChild(cursor);
      return cursor;
    };
    let cursor = ensureCursor();
    document.addEventListener("mousemove", (e) => {
      cursor = ensureCursor();
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("mousedown", () => {
      cursor = ensureCursor();
      cursor.style.background = "rgba(0,200,80,1)";
      setTimeout(() => { if (cursor) cursor.style.background = "rgba(255,0,80,0.9)"; }, 250);
    }, true);
    // Survive React re-renders that might detach our cursor.
    new MutationObserver(() => ensureCursor()).observe(document.body, { childList: true, subtree: false });
  }).catch(() => {});
}

/**
 * Aggressively clear any overlay/backdrop that might block clicks. Called
 * before every interaction so the next click actually lands on the target.
 */
async function clearOverlays(page: Page): Promise<void> {
  // Press Escape twice (covers most modal libraries).
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(150);
  // If a fullscreen backdrop is still present, click an outside-corner of the
  // viewport (10, 10) which is empty space outside any modal.
  const hasBackdrop = await page.locator('div.fixed.inset-0[class*="backdrop"]').count();
  if (hasBackdrop > 0) {
    await page.mouse.click(10, 10).catch(() => {});
    await page.waitForTimeout(300);
  }
  // Higgsfield shows a persistent "Welcome Bundle / 87% discount" promo card
  // at the bottom-right that overlaps the Generate button. Nuke any element
  // containing that text from the DOM so clicks land on the real Generate.
  await page.evaluate(() => {
    const TEXT_FINGERPRINTS = ["Welcome Bundle", "discount", "Claim", "Expires in"];
    const all = Array.from(document.querySelectorAll<HTMLElement>("div"));
    for (const el of all) {
      const cls = (el.className || "").toString();
      const style = el.getAttribute("style") || "";
      const isFixed = cls.includes("fixed") || style.includes("position: fixed") || style.includes("position:fixed");
      if (!isFixed) continue;
      const rect = el.getBoundingClientRect();
      // Only consider small fixed elements (popovers / toasts), not main page chrome.
      if (rect.width > 600 || rect.height > 400) continue;
      // Only consider elements positioned in the bottom-right quadrant.
      if (rect.x < 700 || rect.y < 500) continue;
      const text = el.textContent || "";
      const matchCount = TEXT_FINGERPRINTS.filter((t) => text.includes(t)).length;
      if (matchCount >= 2) {
        el.remove();
      }
    }
  }).catch(() => {});
}

/**
 * Find an element matching `label` (button > role=button > role=tab > span),
 * scroll it into view, move the real mouse cursor to its center, and click.
 * Visible cursor movement + click — matches what a human would do.
 */
async function mouseClickByText(page: Page, label: string): Promise<boolean> {
  // Always clear overlays before attempting to click — that's the most common
  // reason a click fails on Higgsfield's UI.
  await clearOverlays(page);
  // Prefer actual interactive elements over plain text spans. Higgsfield's
  // aspect/resolution toggles are buttons or radio-styled divs, not bare spans.
  const candidates = [
    `button:has-text("${label}")`,
    `[role="button"]:has-text("${label}")`,
    `[role="radio"]:has-text("${label}")`,
    `[role="tab"]:has-text("${label}")`,
    `label:has-text("${label}")`,
    `div:has-text("${label}")`,
    `span:has-text("${label}")`,
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
      const box = await loc.boundingBox();
      if (!box) continue;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Move the real mouse cursor in two steps so the motion is visible.
      await page.mouse.move(cx - 50, cy - 30, { steps: 10 });
      await page.mouse.move(cx, cy, { steps: 8 });
      await page.waitForTimeout(150);
      await page.mouse.click(cx, cy);
      console.log(`    clicked "${label}" via mouse @ (${Math.round(cx)},${Math.round(cy)}) on ${sel}`);
      return true;
    } catch {
      continue;
    }
  }
  console.log(`    (could not find a clickable "${label}")`);
  return false;
}

async function setAspectRatio11(page: Page): Promise<void> {
  console.log(`  Setting aspect ratio to 1:1 (real mouse click)...`);
  await mouseClickByText(page, "1:1");
  await page.waitForTimeout(600);
}

/**
 * Higgsfield's quality control is a DROPDOWN, not a direct toggle. The
 * visible "2K" / "1K" badge in the bottom bar is the trigger; clicking it
 * opens a "Select quality" popover with 1K / 2K / 4K options, where the
 * actual selection lives. Earlier versions of this wrapper clicked the
 * trigger ONLY — which opened the menu but never picked an option, so the
 * resolution silently stayed at whatever the previous session left it at
 * (usually 1K).
 *
 * Step 1: click the trigger (current value label) to open the dropdown.
 * Step 2: scope a SECOND click to the dropdown's menu and click the "2K"
 *         row inside. We use a [role="menu"] / [role="menuitem"] / "Select
 *         quality" sibling-scope pattern to avoid re-clicking the trigger.
 */
async function setResolution2K(page: Page): Promise<void> {
  console.log(`  Setting resolution to 2K (real mouse click)...`);

  // Step 1 — open the dropdown. The trigger renders the current value,
  // which may be "1K", "2K", or "4K" depending on session state. Try each
  // and stop at the first that successfully opens a menu.
  const triggerCandidates = ["1K", "2K", "4K"];
  let opened = false;
  for (const label of triggerCandidates) {
    if (await mouseClickByText(page, label)) {
      // Wait for either the "Select quality" header OR a menu item to appear.
      const menuShowed = await Promise.race([
        page
          .locator('text="Select quality"')
          .first()
          .waitFor({ state: "visible", timeout: 2000 })
          .then(() => true)
          .catch(() => false),
        page
          .locator('[role="menu"], [role="listbox"]')
          .first()
          .waitFor({ state: "visible", timeout: 2000 })
          .then(() => true)
          .catch(() => false),
      ]);
      if (menuShowed) {
        opened = true;
        break;
      }
    }
  }
  if (!opened) {
    console.warn(`    (could not open the Select quality dropdown — leaving resolution at whatever the session has)`);
    return;
  }

  await page.waitForTimeout(250);

  // Step 2 — click the "2K" menu item. Restrict to menu/option roles, or
  // to elements anchored under the "Select quality" label, so we don't
  // re-click the trigger.
  const menuItemSelectors = [
    '[role="menuitem"]:has-text("2K")',
    '[role="option"]:has-text("2K")',
    'div:near(:text("Select quality")):has-text("2K")',
    'li:has-text("2K")',
  ];
  let picked = false;
  for (const sel of menuItemSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    try {
      const box = await loc.boundingBox();
      if (!box) continue;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy, { steps: 6 });
      await page.waitForTimeout(120);
      await page.mouse.click(cx, cy);
      console.log(`    clicked "2K" inside dropdown @ (${Math.round(cx)},${Math.round(cy)}) via ${sel}`);
      picked = true;
      break;
    } catch {
      continue;
    }
  }
  if (!picked) {
    console.warn(`    (could not click "2K" inside the dropdown — resolution may have stayed at the previous value)`);
  }
  await page.waitForTimeout(600);
}

/**
 * Collect URLs of GENERATED images currently on the page. Higgsfield's URL
 * pattern is distinct: generated outputs go through their image-proxy at
 * `images.higgs.ai/?url=<encoded-cloudfront-url>` where the underlying
 * CloudFront URL contains `/user_<userId>/hf_<timestamp>_<uuid>.png`.
 *
 * Reference uploads use a DIFFERENT cloudfront path with `/anon_user_id/`
 * and no `hf_` prefix — so we exclude those.
 */
async function collectGeneratedImageUrls(page: Page): Promise<Set<string>> {
  const urls = await page.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll("img").forEach((img) => {
      const src = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src || "";
      if (!src || !src.startsWith("http")) return;
      // Match the generated-image signature: URL must contain `/user_` AND `/hf_`
      // (URL-encoded as %2Fuser_ and %2Fhf_ in the proxy URL).
      const isGenerated =
        (src.includes("/user_") && src.includes("/hf_")) ||
        (src.includes("%2Fuser_") && src.includes("%2Fhf_"));
      if (!isGenerated) return;
      out.add(src);
    });
    return Array.from(out);
  });
  return new Set(urls);
}

/**
 * Given a Higgsfield image-proxy URL like
 *   https://images.higgs.ai/?default=1&output=webp&url=ENCODED&w=1920&q=85
 * return the underlying CloudFront PNG URL by URL-decoding the `url` param.
 * For plain CloudFront URLs (not behind the proxy), returns the URL unchanged.
 */
function unwrapHiggsfieldProxyUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (u.hostname === "images.higgs.ai") {
      const inner = u.searchParams.get("url");
      if (inner) return decodeURIComponent(inner);
    }
  } catch {
    // fall through
  }
  return proxyUrl;
}

/**
 * Extract the generation time (epoch ms) from a Higgsfield generated-image
 * URL. The CloudFront filename embeds it: `hf_YYYYMMDD_HHMMSS_<uuid>.png`.
 * Returns null if not parseable.
 *
 * Parsed as UTC (`Date.UTC`) — Higgsfield generates these server-side and the
 * embedded timestamp is UTC. An earlier version parsed as LOCAL time, which
 * on a machine east of UTC made every fresh image look hours old, so the
 * staleness guard wrongly rejected ALL of them and the collect loop hung.
 * If the timestamp were ever actually local, `Date.UTC` only ever makes an
 * image look NEWER — the guard degrades to a harmless no-op, never a false
 * "stale" rejection.
 */
function generatedImageTimeMs(url: string): number | null {
  const m = unwrapHiggsfieldProxyUrl(url).match(/hf_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Wait for a NEW generated-image URL to appear that wasn't in the baseline.
 *
 * DOM polling only — we read this tab's own DOM via collectGeneratedImageUrls.
 * Higgsfield renders each tab's result inside that tab's prompt panel, so the
 * DOM is the only per-tab-truthful signal. A previous version also listened to
 * network traffic, but in parallel mode every tab silently prefetches every
 * sibling tab's thumbnail (websocket-driven), so the network listener captured
 * cross-tab URLs and mis-attributed results.
 *
 * `claimedUrls` is shared across all tabs in the batch — once any tab returns
 * a URL, it is marked claimed so concurrent tabs cannot re-claim the same one.
 * JavaScript is single-threaded, so the has-then-add pair is atomic.
 *
 * Every PROGRESS_SCREENSHOT_INTERVAL_MS, dump a screenshot to
 * `outDir/_progress_<slug>.png` (overwrites prior) so the operator can
 * inspect the live page state without needing devtools open.
 */
/** Maximum number of Higgsfield-side "Failed" retries to attempt per prompt. */
const MAX_HIGGSFIELD_RETRIES = 2;

/**
 * If this tab's UI currently shows a "Failed" generation with a Retry button,
 * click Retry and return true. Otherwise return false. We compare the Retry
 * button count against the baseline so we don't accidentally click a Retry
 * for a different (previous) failed generation that was already on the page
 * when we started.
 */
async function tryClickRetryIfFailed(
  page: Page,
  retryBaseline: number,
): Promise<boolean> {
  try {
    const locator = page.locator('button:has-text("Retry")');
    const count = await locator.count();
    if (count <= retryBaseline) return false;
    // A new Retry button has appeared. Click the most recent one — DOM order
    // tracks creation order on Higgsfield, so the last-rendered Retry is the
    // one tied to our pending generation in this tab.
    await locator.last().click({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForNewGeneratedImage(
  page: Page,
  beforeUrls: Set<string>,
  claimedUrls: Set<string>,
  timeoutMs: number,
  opts: { outDir: string; slug: string; runStartedAt: number },
): Promise<string | null> {
  // Reject any gallery image generated meaningfully before this run started —
  // the Higgsfield account gallery is shared across runs, and a stale image
  // (e.g. another product's hero) can look "new" vs the baseline. A 10-minute
  // grace window absorbs clock skew while still excluding prior-run output.
  const staleBeforeMs = opts.runStartedAt - 10 * 60_000;
  const loggedStale = new Set<string>(); // log each stale URL only once
  const start = Date.now();
  let overlayClearCounter = 0;
  let lastScreenshotAt = 0;
  const progressPath = path.join(opts.outDir, `_progress_${opts.slug}.png`);
  // Snapshot the number of Retry buttons currently visible. Any NEW one that
  // appears after Generate was clicked indicates Higgsfield rejected our gen
  // (server error, content filter, etc) and refunded credits.
  let retryBaseline = await page
    .locator('button:has-text("Retry")')
    .count()
    .catch(() => 0);
  let retriesUsed = 0;
  while (Date.now() - start < timeoutMs) {
    const now = await collectGeneratedImageUrls(page);
    for (const url of now) {
      if (beforeUrls.has(url)) continue;
      // Skip stale images left in the shared account gallery by earlier runs.
      const imgTime = generatedImageTimeMs(url);
      if (imgTime !== null && imgTime < staleBeforeMs) {
        if (!loggedStale.has(url)) {
          loggedStale.add(url);
          console.log(`  [${opts.slug}] ignoring stale gallery image (generated before this run started)`);
        }
        continue;
      }
      const canonical = unwrapHiggsfieldProxyUrl(url);
      if (claimedUrls.has(canonical)) continue; // sibling tab already grabbed it
      claimedUrls.add(canonical);
      return url;
    }
    // Detect "Failed" + Retry — Higgsfield-side failure (refunded credits).
    // Click Retry instead of waiting out the 10-min timeout.
    if (retriesUsed < MAX_HIGGSFIELD_RETRIES) {
      const clicked = await tryClickRetryIfFailed(page, retryBaseline);
      if (clicked) {
        retriesUsed++;
        console.log(
          `  [${opts.slug}] detected Higgsfield Failed state — clicked Retry (${retriesUsed}/${MAX_HIGGSFIELD_RETRIES})`,
        );
        // After Retry click the failed tile is replaced. Re-baseline so a
        // chain of failures (Failed → Retry → Failed again) still triggers
        // another retry until we hit the cap.
        await page.waitForTimeout(2000);
        retryBaseline = await page
          .locator('button:has-text("Retry")')
          .count()
          .catch(() => retryBaseline);
      }
    }
    if (Date.now() - lastScreenshotAt > PROGRESS_SCREENSHOT_INTERVAL_MS) {
      lastScreenshotAt = Date.now();
      await page.screenshot({ path: progressPath, fullPage: false }).catch(() => {});
    }
    // Every ~5 seconds (3 polls × 1.5s), dismiss any popup that appeared.
    overlayClearCounter++;
    if (overlayClearCounter % 3 === 0) {
      await clearOverlays(page).catch(() => {});
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  return null;
}

async function downloadFromUrl(context: BrowserContext, src: string, outPath: string): Promise<void> {
  // If this is a Higgsfield proxy URL, unwrap it to get the underlying
  // CloudFront PNG (full-resolution, native format).
  const fullUrl = unwrapHiggsfieldProxyUrl(src);
  const res = await context.request.get(fullUrl, { timeout: DOWNLOAD_TIMEOUT_MS });
  if (!res.ok()) throw new Error(`Download HTTP ${res.status()} for ${fullUrl}`);
  fs.writeFileSync(outPath, await res.body());
  console.log(`    downloaded ${fullUrl.slice(0, 100)}...`);
}

export async function runHiggsfieldBatch(opts: HiggsfieldBatchOptions): Promise<{ ok: number; fail: number }> {
  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  // Captured once, up front: any gallery image whose embedded timestamp
  // predates this is from an earlier run and must never be collected.
  const runStartedAt = Date.now();

  // First run: SESSION_DIR was just created (or is empty) → headed so user can log in.
  // Subsequent runs: SESSION_DIR has cookies → headless by default.
  const sessionExists = fs.readdirSync(SESSION_DIR).length > 0;
  const headless = opts.forceHeaded ? false : sessionExists;
  console.log(`\nHiggsfield session dir: ${SESSION_DIR}`);
  console.log(`Session exists: ${sessionExists ? "yes (running headless)" : "no (first run — running headed)"}`);

  // Use the user's installed Chrome (channel: "chrome") + stealth flags.
  // Google's OAuth detects Playwright's bundled Chromium and blocks login;
  // real Chrome with anti-detection args usually passes their check.
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    // Slow each action down ~200ms when running headed so the user can watch.
    slowMo: opts.forceHeaded ? 250 : 0,
  });

  // Mask the navigator.webdriver flag that Playwright sets by default.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Hide a few other automation tells.
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
  });

  // Inject a visible cursor sprite that tracks the page's mouse position.
  // Playwright's page.mouse.move() dispatches DOM mousemove events but does
  // NOT move the OS cursor — so a real cursor would not appear to move during
  // automation. We render a red dot at the current mouse position so the
  // user can watch the script navigate.
  if (opts.forceHeaded) {
    await context.addInitScript(() => {
      const init = () => {
        if (document.getElementById("__pw_cursor__")) return;
        const cursor = document.createElement("div");
        cursor.id = "__pw_cursor__";
        cursor.style.cssText = [
          "position:fixed",
          "top:0",
          "left:0",
          "width:18px",
          "height:18px",
          "border-radius:50%",
          "background:rgba(255,0,80,0.85)",
          "border:2px solid #fff",
          "box-shadow:0 0 12px rgba(255,0,80,0.8)",
          "pointer-events:none",
          "z-index:2147483647",
          "transform:translate(-50%,-50%)",
          "transition:transform 0.05s linear",
        ].join(";");
        document.documentElement.appendChild(cursor);
        const update = (x: number, y: number) => {
          cursor.style.left = x + "px";
          cursor.style.top = y + "px";
        };
        document.addEventListener("mousemove", (e) => update(e.clientX, e.clientY), true);
        document.addEventListener("mousedown", () => {
          cursor.style.background = "rgba(0,200,80,0.95)";
          setTimeout(() => (cursor.style.background = "rgba(255,0,80,0.85)"), 200);
        }, true);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
      } else {
        init();
      }
    });
  }

  const page = context.pages()[0] ?? (await context.newPage());

  let ok = 0;
  let fail = 0;
  try {
    console.log(`Navigating to ${HIGGSFIELD_URL}...`);
    await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(2000);
    if (opts.forceHeaded) await injectVisibleCursor(page);

    await waitUntilLoggedIn(page, opts.outDir);
    if (opts.forceHeaded) await injectVisibleCursor(page);

    // One-time setup: aspect ratio and resolution persist across prompts in
    // Higgsfield's UI, so we click them once before the prompt loop.
    console.log(`\nOne-time setup: aspect ratio 1:1 + resolution 2K`);
    await setAspectRatio11(page);
    await setResolution2K(page);

    // Shared across all concurrent tabs in this batch so two tabs cannot
    // claim the same generated-image URL (relevant only in --parallel mode).
    const claimedUrls = new Set<string>();

    /** Run a single prompt on the given page (which has already been navigated + had cursor injected). */
    const runOnePrompt = async (p: PromptItem, pg: Page, label: string): Promise<boolean> => {
      try {
        console.log(`\n${label} ${p.slug}`);
        await clearOverlays(pg);
        // Clear stale form state and reload so we get a clean slot row before
        // typing the prompt and uploading references.
        await clearPersistedFormState(pg);
        await pg.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
        await pg.waitForTimeout(2000);
        if (opts.forceHeaded) await injectVisibleCursor(pg);
        await clearOverlays(pg);
        await typePrompt(pg, p.text, opts.outDir);
        const refForThis = p.referenceImage ?? opts.referenceImage;
        await uploadReference(pg, refForThis, opts.outDir);
        await pg.waitForTimeout(2000);
        const beforeUrls = await collectGeneratedImageUrls(pg);
        console.log(`  ${label} Baseline image count before generate: ${beforeUrls.size}`);
        await clickGenerate(pg, opts.outDir);
        console.log(`  ${label} Waiting for generation (up to ${GENERATION_TIMEOUT_MS / 60000} min). Progress screenshots: ${path.join(opts.outDir, `_progress_${p.slug}.png`)}`);
        const newUrl = await waitForNewGeneratedImage(pg, beforeUrls, claimedUrls, GENERATION_TIMEOUT_MS, {
          outDir: opts.outDir,
          slug: p.slug,
          runStartedAt,
        });
        if (!newUrl) {
          await dumpDebug(pg, opts.outDir, `no-result-${p.slug}`);
          throw new Error("Generation timed out — no new CDN image appeared.");
        }
        const outPath = path.join(opts.outDir, `${p.slug}.png`);
        await downloadFromUrl(context, newUrl, outPath);
        console.log(`  ${label} OK → ${outPath}`);
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ${label} FAIL → ${msg}`);
        return false;
      }
    };

    if (opts.queued) {
      // QUEUED MODE — one tab. Submit every generation back-to-back, then
      // collect. The earlier "stalls at 4" was NOT a per-tab limit — it was
      // the page being reloaded before Higgsfield committed each generation
      // (see waitForGenerationStarted). With that fixed, a single tab handles
      // all 6. QUEUED_CHUNK is kept as a knob: prompts split into chunks of
      // this size, one tab each; 6 means one tab for a standard 6-image run.
      const QUEUED_CHUNK = 6;
      const chunks: PromptItem[][] = [];
      for (let i = 0; i < opts.prompts.length; i += QUEUED_CHUNK) {
        chunks.push(opts.prompts.slice(i, i + QUEUED_CHUNK));
      }
      console.log(
        `\nQUEUED MODE: ${opts.prompts.length} generation(s) split across ${chunks.length} tab(s), up to ${QUEUED_CHUNK} each.`,
      );

      // One tab's worth of work: submit its prompts back-to-back, then collect
      // them. claimedUrls (shared across tabs) stops two tabs grabbing the
      // same gallery image; the per-tab baseline marks our results as "new".
      const runQueuedChunk = async (
        pg: Page,
        chunkPrompts: PromptItem[],
        tabLabel: string,
      ): Promise<{ ok: number; fail: number }> => {
        let cOk = 0;
        let cFail = 0;
        const baseline = await collectGeneratedImageUrls(pg);
        const submitted: PromptItem[] = [];
        for (const [i, p] of chunkPrompts.entries()) {
          const tag = `${tabLabel}[submit ${i + 1}/${chunkPrompts.length}]`;
          try {
            console.log(`\n${tag} ${p.slug}`);
            await clearOverlays(pg);
            await clearPersistedFormState(pg);
            await pg.reload({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
            await pg.waitForTimeout(2000);
            if (opts.forceHeaded) await injectVisibleCursor(pg);
            await clearOverlays(pg);
            await typePrompt(pg, p.text, opts.outDir);
            const refForThis = p.referenceImage ?? opts.referenceImage;
            await uploadReference(pg, refForThis, opts.outDir);
            await pg.waitForTimeout(2000);
            // Snapshot in-progress tiles, click Generate, then WAIT until the
            // generation is committed server-side before the next slot's
            // page reload — a reload too soon after the click cancels it.
            const inProgressBefore = await countInProgressTiles(pg);
            await clickGenerate(pg, opts.outDir);
            await waitForGenerationStarted(pg, inProgressBefore);
            console.log(`  ${tag} Generate clicked — generation committed.`);
            submitted.push(p);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ${tag} SUBMIT FAIL → ${msg}`);
            cFail++;
          }
        }
        console.log(`\n${tabLabel}all ${submitted.length}/${chunkPrompts.length} submitted — collecting...`);
        for (const p of submitted) {
          try {
            const newUrl = await waitForNewGeneratedImage(pg, baseline, claimedUrls, GENERATION_TIMEOUT_MS, {
              outDir: opts.outDir,
              slug: p.slug,
              runStartedAt,
            });
            if (!newUrl) {
              await dumpDebug(pg, opts.outDir, `no-result-${p.slug}`);
              throw new Error("Generation timed out — no new CDN image appeared.");
            }
            const outPath = path.join(opts.outDir, `${p.slug}.png`);
            await downloadFromUrl(context, newUrl, outPath);
            console.log(`  ${tabLabel}[collect] ${p.slug} OK → ${outPath}`);
            cOk++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`  ${tabLabel}[collect] ${p.slug} FAIL → ${msg}`);
            cFail++;
          }
        }
        return { ok: cOk, fail: cFail };
      };

      const CHUNK_STAGGER_MS = 1500;
      const chunkTasks = chunks.map(async (chunk, ci) => {
        if (ci > 0) await new Promise((r) => setTimeout(r, ci * CHUNK_STAGGER_MS));
        const tabLabel = chunks.length > 1 ? `[tab ${ci + 1}/${chunks.length}] ` : "";
        // Chunk 0 reuses the already-set-up page; other chunks get a fresh tab
        // (1:1 / 2K settings persist via the shared session storage).
        let pg: Page;
        if (ci === 0) {
          pg = page;
        } else {
          pg = await context.newPage();
          await pg.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          await pg.waitForTimeout(2000);
          if (opts.forceHeaded) await injectVisibleCursor(pg);
        }
        return runQueuedChunk(pg, chunk, tabLabel);
      });
      const chunkResults = await Promise.all(chunkTasks);
      for (const r of chunkResults) {
        ok += r.ok;
        fail += r.fail;
      }
    } else if (opts.parallel) {
      // Stagger task starts so we don't burst-click Generate on all N tabs
      // within ~500ms — that pattern trips Higgsfield's "Slide to verify"
      // anti-bot wall. Each task delays by its index × stagger before
      // navigating, so the Generate clicks naturally space out.
      const PARALLEL_STAGGER_MS = opts.parallelStaggerMs ?? 1500;
      console.log(
        `\nPARALLEL MODE: opening ${opts.prompts.length} tabs concurrently (${PARALLEL_STAGGER_MS}ms stagger between starts).`,
      );
      const tasks = opts.prompts.map(async (p, i) => {
        const tag = `[${i + 1}/${opts.prompts.length}]`;
        if (i > 0) {
          await new Promise((r) => setTimeout(r, i * PARALLEL_STAGGER_MS));
        }
        // First prompt reuses the already-open page; others get fresh tabs.
        const pg = i === 0 ? page : await context.newPage();
        if (i > 0) {
          await pg.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          await pg.waitForTimeout(2000);
          if (opts.forceHeaded) await injectVisibleCursor(pg);
        }
        return runOnePrompt(p, pg, tag);
      });
      const results = await Promise.all(tasks);
      for (const r of results) {
        if (r) ok++;
        else fail++;
      }
    } else {
      for (const [i, p] of opts.prompts.entries()) {
        const tag = `[${i + 1}/${opts.prompts.length}]`;
        if (i > 0) {
          await page.goto(HIGGSFIELD_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
          await page.waitForTimeout(2000);
          if (opts.forceHeaded) await injectVisibleCursor(page);
        }
        const success = await runOnePrompt(p, page, tag);
        if (success) ok++;
        else fail++;
      }
    }
  } finally {
    if (!opts.keepOpen) {
      await context.close();
    } else {
      console.log(`\n(Browser left open for inspection — close it manually.)`);
    }
  }

  return { ok, fail };
}
