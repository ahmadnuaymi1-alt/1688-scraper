/**
 * Playwright-driven dimension scanner for teemdrop.
 *
 * 1688 detail pages are bot-locked and hard to drive with Playwright. Teemdrop
 * mirrors 1688 listings — we can use teemdrop's "search by 1688 URL" feature
 * to look up the mirror product, then scrape variant images + description from
 * teemdrop's product page reliably.
 *
 * Accepts two input shapes:
 *   - 1688 URL (https://detail.1688.com/offer/...) — script logs in, uses the
 *     teemdrop product-search-by-URL flow to locate the mirror, then scrapes it.
 *   - teemdrop URL (https://teemdrop.com/... or https://seller.teemdrop.com/...)
 *     — skips the search flow and scrapes directly.
 *
 * The script:
 *   1. Reads TEEMDROP_EMAIL / TEEMDROP_PASSWORD from .env.local.
 *   2. Logs into teemdrop.
 *   3. Resolves the input URL to a teemdrop product page (search-by-URL when
 *      handed a 1688 URL).
 *   4. Best-effort clicks every variant swatch / option button, surfacing
 *      variant-specific imagery + lazily-rendered text.
 *   5. Collects the page's full innerText.
 *   6. Runs a battery of dimension regexes (cm/mm/inch, L×W×H, 长宽高) and
 *      prints any hits as a sorted, deduped list with surrounding snippet.
 *   7. Saves debug screenshots to scripts/_dimension-scanner-step-*.png so
 *      DOM changes can be diagnosed when selectors stop matching.
 *
 * Output is text only. No DB writes — the user decides what to do with the
 * findings.
 *
 * Usage:
 *   npx tsx scripts/_dimension-scanner.ts <url> [--headless] [--no-clicks]
 *
 * On first run you may need: `npx playwright install chromium`
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";

function loadEnvLocal(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

function parseArgs() {
  const url = process.argv[2];
  const headless = process.argv.includes("--headless");
  const skipClicks = process.argv.includes("--no-clicks");
  return { url, headless, skipClicks };
}

// teemdrop has two faces — `teemdrop.com` (product search / sourcing) and
// `seller.teemdrop.com` (seller dashboard). The login form is the same SSO
// either way. We start at the consumer face since that's where the
// product-search-by-1688-URL flow lives.
const HOME_URL = "https://teemdrop.com/";
const LOGIN_URL = "https://teemdrop.com/login";
const SCREENSHOT_DIR = "scripts";

function isOn1688(url: string): boolean {
  return /1688\.com\//.test(url);
}
function isOnTeemdrop(url: string): boolean {
  return /(^|\.)teemdrop\.com\//.test(url);
}

// Dimension regexes — generous on what counts. We post-process to dedupe.
const DIM_REGEXES: Array<{ name: string; re: RegExp }> = [
  // 30 x 20 x 15 cm  /  30×20×15cm  /  30*20*15 cm
  { name: "L×W×H cm", re: /\b(\d{1,3}(?:\.\d+)?)\s*[xX×*]\s*(\d{1,3}(?:\.\d+)?)\s*[xX×*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:cm|centimeters?)\b/gi },
  // 30 x 20 cm
  { name: "W×H cm", re: /\b(\d{1,3}(?:\.\d+)?)\s*[xX×*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:cm|centimeters?)\b/gi },
  // mm variants
  { name: "L×W×H mm", re: /\b(\d{2,4}(?:\.\d+)?)\s*[xX×*]\s*(\d{2,4}(?:\.\d+)?)\s*[xX×*]\s*(\d{2,4}(?:\.\d+)?)\s*(?:mm|millimeters?)\b/gi },
  // inch / "  — 13" × 10"  /  13 in x 10 in
  { name: "inch", re: /\b(\d{1,3}(?:\.\d+)?)\s*(?:inch|inches|in|")(?:\s*[xX×*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:inch|inches|in|"))?(?:\s*[xX×*]\s*(\d{1,3}(?:\.\d+)?)\s*(?:inch|inches|in|"))?/gi },
  // Standalone "Height 28.5cm" / "Width 15 cm"
  { name: "labeled cm", re: /\b(?:height|width|depth|length|diameter|高|宽|长|深|径)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:cm|mm|厘米|毫米)\b/gi },
];

function extractDimensions(corpus: string): Array<{ source: string; match: string; snippet: string }> {
  const hits: Array<{ source: string; match: string; snippet: string }> = [];
  const seen = new Set<string>();
  for (const { name, re } of DIM_REGEXES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(corpus)) !== null) {
      const match = m[0].trim();
      const key = `${name}::${match.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = Math.max(0, m.index - 40);
      const end = Math.min(corpus.length, m.index + match.length + 40);
      const snippet = corpus
        .slice(start, end)
        .replace(/\s+/g, " ")
        .trim();
      hits.push({ source: name, match, snippet });
    }
  }
  return hits;
}

async function snap(page: Page, label: string) {
  const file = `${SCREENSHOT_DIR}/_dimension-scanner-step-${label}.png`;
  try {
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  📸 ${file}`);
  } catch {
    // ignore screenshot errors — not critical
  }
}

async function login(page: Page, email: string, password: string) {
  console.log(`Logging in via ${LOGIN_URL}`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await snap(page, "01-login-page");

  const emailInput = page
    .locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]')
    .first();
  const passwordInput = page
    .locator('input[type="password"], input[name="password"]')
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 15_000 });
  await emailInput.fill(email);
  await passwordInput.fill(password);

  // Capture the form state right before we try to submit so any submit-control
  // failure can be diagnosed by eye.
  await snap(page, "02a-pre-submit");

  // Teemdrop's login form has no real <button> — the submit control is a
  // styled element that matches multiple bogus selectors. The canonical form
  // submission method (Enter in the password field) is more reliable and
  // works for every login form we've seen.
  console.log("  submitting via Enter in password field");
  await passwordInput.press("Enter").catch(() => null);

  // Wait for navigation away from /login. If we're still on /login after the
  // grace window, surface an error so the script doesn't proceed with no
  // session (which would cause every subsequent step to land on the login
  // wall again).
  await page
    .waitForURL((u) => !u.toString().toLowerCase().includes("/login"), { timeout: 30_000 })
    .catch(() => null);
  await snap(page, "02b-post-submit");

  const finalUrl = page.url();
  console.log(`Post-login URL: ${finalUrl}`);
  if (/\/login(\?|$|\/)/i.test(finalUrl)) {
    throw new Error(
      `Login did not leave the /login URL — credentials may be wrong or the submit-button selector still didn't match. See screenshots 02a / 02b in scripts/.`,
    );
  }

  // Teemdrop bounces through a JWT-bearing /middlePage URL before settling
  // on the seller dashboard. Wait it out so the next step (product search)
  // doesn't run against a half-loaded page with zero inputs.
  if (/middlePage/i.test(finalUrl)) {
    console.log("  on /middlePage redirect — waiting for dashboard to settle");
    await page
      .waitForURL((u) => !u.toString().toLowerCase().includes("middlepage"), {
        timeout: 30_000,
      })
      .catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
    console.log(`  settled at: ${page.url()}`);
    await snap(page, "02c-dashboard");
  }
}

/**
 * Resolve a 1688 URL to a teemdrop product page.
 *
 * Teemdrop's product detail page accepts the 1688 offer ID directly via
 * query string:
 *   https://seller.teemdrop.com/find-product/product-detail?id=<offerId>&source=AL&timestamp=<ms>
 *
 * Driving the UI search flow is brittle (modal dismissal + mode switching +
 * tab switching + finding the right input). Constructing the URL is
 * deterministic and works on every product. We keep the screenshots so we
 * can confirm we landed on a real product page and not a 404.
 */
async function searchTeemdropFor1688Url(page: Page, url1688: string): Promise<string | null> {
  console.log(`\nResolving teemdrop product page for 1688 URL: ${url1688}`);

  // Extract the offer ID from /offer/<digits>.html.
  const match = url1688.match(/offer\/(\d+)(?:\.html)?/i);
  if (!match) {
    console.log(`  could not parse offer id from ${url1688}`);
    return null;
  }
  const offerId = match[1];
  console.log(`  offer id: ${offerId}`);

  const teemdropUrl = `https://seller.teemdrop.com/find-product/product-detail?id=${offerId}&source=AL&timestamp=${Date.now()}`;
  console.log(`  navigating: ${teemdropUrl}`);

  await page.goto(teemdropUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(1500);
  await snap(page, "03-product-detail");

  const landedUrl = page.url();
  console.log(`  landed at: ${landedUrl}`);

  // Sanity-check: 404 page has body text "not found"; redirect-to-login
  // means our session expired.
  const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  if (/^\s*not found\b/i.test(bodyText) || bodyText.length < 200) {
    console.log("  page looks empty/404. The 1688 product may not be mirrored on teemdrop.");
    await snap(page, "04-empty-or-404");
    return null;
  }
  if (/login/i.test(landedUrl)) {
    console.log("  redirected back to /login — session lost.");
    return null;
  }

  return landedUrl;
}

// Old UI-driven search flow — kept for reference but the URL-construction
// path above is preferred. Not called.
async function _searchTeemdropFor1688UrlUI(page: Page, url1688: string): Promise<string | null> {
  console.log(`\nSearching teemdrop for 1688 URL: ${url1688}`);

  // Step 0: Dismiss any blocking modal. Teemdrop shows a "Logistics Price
  // Adjustment Notice" daily; its dismissal control is "Cancel" (or the
  // close X). Other modals use Got it / OK / Close. Try all known labels.
  for (const modalSel of [
    '.ant-modal-wrap button:has-text("Cancel")',
    '[role="dialog"] button:has-text("Cancel")',
    'button:has-text("Cancel")',
    'button:has-text("Got it")',
    'button:has-text("Got It")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    '[role="dialog"] [aria-label*="close" i]',
    '[role="dialog"] .ant-modal-close',
    '.ant-modal-close',
  ]) {
    const m = page.locator(modalSel).first();
    if ((await m.count()) > 0 && (await m.isVisible().catch(() => false))) {
      try {
        await m.click({ timeout: 2000 });
        console.log(`  dismissed modal via "${modalSel}"`);
        await page.waitForTimeout(500);
        break;
      } catch {
        // try next
      }
    }
  }

  // Step 1: The /td-home page has a "Start Direct Sourcing" button that opens
  // a URL-paste modal — the actual paste workflow for 1688 URLs. The Image /
  // URL / Keywords chips on the page are search-mode filters for a BROWSE
  // view, not URL pasting. Click "Start Direct Sourcing" to enter the paste
  // dialog.
  console.log("  clicking Start Direct Sourcing");
  let entered = false;
  for (const sel of [
    page.getByText("Start Direct Sourcing", { exact: true }).first(),
    page.locator('button:has-text("Start Direct Sourcing")').first(),
    page.locator('a:has-text("Start Direct Sourcing")').first(),
    page.locator('[role="button"]:has-text("Start Direct Sourcing")').first(),
  ]) {
    if ((await sel.count().catch(() => 0)) === 0) continue;
    if (!(await sel.isVisible().catch(() => false))) continue;
    try {
      await sel.click({ timeout: 3000 });
      await page.waitForTimeout(1500);
      entered = true;
      break;
    } catch {
      // try next
    }
  }
  if (!entered) {
    console.log("  Start Direct Sourcing button not found — falling back to current page");
  }

  await snap(page, "03-search-entry");
  if (!entered) {
    console.log(
      "  no entry-point matched — looking for an input on the current page anyway.",
    );
    // Diagnostic: list every visible link in case the label changed.
    const visibleLinks = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("a, button").forEach((el) => {
        const a = el as HTMLElement;
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && a.offsetParent !== null) {
          const text = (a.innerText || a.textContent || "").trim();
          if (text && text.length < 60) out.push(`<${a.tagName.toLowerCase()}> "${text}"`);
        }
      });
      return out.slice(0, 60);
    });
    console.log("  visible interactive elements:");
    for (const l of visibleLinks) console.log(`    ${l}`);
  }

  // Step 2: Find an input that accepts a 1688 URL. Also look at <textarea>
  // since paste-URL fields sometimes use one. Pass 1: prefer fields whose
  // placeholder/aria mention url / link / 1688 / paste. Pass 2: fall back
  // to the first visible non-trivial input.
  const inputCandidates = await page
    .locator(
      'input[type="text"], input[type="url"], input[type="search"], input:not([type]), textarea',
    )
    .all();
  console.log(`  ${inputCandidates.length} candidate input field(s) on page`);

  const inspected: Array<{ inp: typeof inputCandidates[number]; placeholder: string; aria: string; name: string; visible: boolean }> = [];
  for (const inp of inputCandidates) {
    const placeholder = (await inp.getAttribute("placeholder").catch(() => "")) ?? "";
    const aria = (await inp.getAttribute("aria-label").catch(() => "")) ?? "";
    const name = (await inp.getAttribute("name").catch(() => "")) ?? "";
    const visible = await inp.isVisible().catch(() => false);
    inspected.push({ inp, placeholder, aria, name, visible });
  }

  let urlInput = null;
  // Pass 1: hint-matched + visible
  for (const c of inspected) {
    if (!c.visible) continue;
    const hints = `${c.placeholder} ${c.aria} ${c.name}`.toLowerCase();
    if (/url|link|1688|paste|product\s*url|sourcing/.test(hints)) {
      urlInput = c.inp;
      console.log(`  using URL-hint input — placeholder="${c.placeholder}" name="${c.name}" aria="${c.aria}"`);
      break;
    }
  }
  // Pass 2: any visible input
  if (!urlInput) {
    for (const c of inspected) {
      if (!c.visible) continue;
      urlInput = c.inp;
      console.log(`  using first visible input (no URL hint matched) — placeholder="${c.placeholder}" name="${c.name}" aria="${c.aria}"`);
      break;
    }
  }
  // Diagnostic dump if nothing usable
  if (!urlInput) {
    console.log("  all candidate inputs:");
    for (const c of inspected) {
      console.log(`    visible=${c.visible} placeholder="${c.placeholder}" name="${c.name}" aria="${c.aria}"`);
    }
  }
  if (!urlInput) {
    console.log("  no URL input field located. Saving screenshot and exiting.");
    await snap(page, "04-no-search-input");
    return null;
  }

  // Step 3: Paste the URL. Some sites validate on blur; trigger Enter too.
  await urlInput.fill(url1688);
  await urlInput.press("Enter").catch(() => null);
  await page.waitForTimeout(800);
  await snap(page, "05-after-paste");

  // Step 4: Look for a search button if Enter didn't trigger the search.
  const searchBtnSelectors = [
    'button:has-text("Search")',
    'button:has-text("Find")',
    'button:has-text("Source")',
    'button[type="submit"]',
  ];
  for (const sel of searchBtnSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      try {
        await btn.click({ timeout: 3000 });
        console.log(`  clicked search button "${sel}"`);
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => null);
        break;
      } catch {
        // try next
      }
    }
  }
  await snap(page, "06-search-result");

  // Step 5: If the search took us to a product page, we're done. Otherwise
  // click the first result tile that looks like a product.
  let currentUrl = page.url();
  if (/\/product\/|\/p\/|\/item\/|\/listing\//.test(currentUrl)) {
    console.log(`  search landed directly on product page: ${currentUrl}`);
    return currentUrl;
  }

  const resultTileSelectors = [
    'a[href*="/product/"]',
    'a[href*="/p/"]',
    'a[href*="/item/"]',
    'a[href*="/listing/"]',
    "[data-product-id]",
    "[data-testid*='product' i]",
  ];
  for (const sel of resultTileSelectors) {
    const tile = page.locator(sel).first();
    if ((await tile.count()) > 0) {
      try {
        console.log(`  clicking first result via "${sel}"`);
        await tile.click({ timeout: 4000 });
        await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => null);
        await page.waitForTimeout(700);
        currentUrl = page.url();
        if (currentUrl !== HOME_URL) {
          console.log(`  landed on: ${currentUrl}`);
          await snap(page, "07-product-page");
          return currentUrl;
        }
      } catch {
        // try next selector
      }
    }
  }

  console.log("  could not click into a product result. Final URL:", currentUrl);
  await snap(page, "07-no-result-click");
  return null;
}

async function clickEveryVariantSwatch(page: Page) {
  // Teemdrop's variant chips don't expose a stable class/role, so DOM-based
  // selectors miss them. The labels DO appear as visible text on the page
  // though, so we enumerate the page's text content for variant-name-shaped
  // strings and click each one by exact text using Playwright's getByText.
  //
  // After clicking, we wait briefly so the variant-specific image + any
  // newly-rendered text panel can settle. Subsequent corpus collection
  // picks up everything from every clicked state.

  // Pass 1: extract every visible chip-shaped label from the page. The
  // teemdrop chip elements have short text (under ~80 chars) and live inside
  // the option panel under the "Size" / option header.
  const candidateLabels = await page.evaluate(() => {
    const labels = new Set<string>();
    // Look for elements whose text matches "<word> <words> <digits> <unit>-<color>"
    // or just the variant name pattern. We err on the side of inclusion since
    // exact-text clicks won't fire on non-matching strings.
    document.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (!el.offsetParent) return;
      const txt = (el.innerText || "").trim();
      if (!txt) return;
      if (txt.length > 80) return;
      // Heuristic: chip labels usually have a hyphen, end with a color word, or
      // contain "mah" / "type" / "model" / "plastic" / "circle" / "shelf".
      if (
        /-(gold|black|silver|white|red|blue)\b/i.test(txt) ||
        /\b(mah|type|model)\b/i.test(txt)
      ) {
        labels.add(txt);
      }
    });
    return Array.from(labels);
  });
  console.log(`  ${candidateLabels.length} candidate chip label(s) found`);

  let totalClicked = 0;
  const collectedTexts: string[] = [];
  const collectedImageUrls: string[] = [];

  for (const label of candidateLabels.slice(0, 25)) {
    const loc = page.getByText(label, { exact: true }).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    try {
      await loc.click({ timeout: 2500, force: false });
      await page.waitForTimeout(450);
      totalClicked++;
      // Snapshot text + image URLs after each click so per-variant content is
      // captured even when the page replaces it on the next click.
      const snapshot = await page.evaluate(() => {
        const text = document.body?.innerText ?? "";
        const imgs = Array.from(document.querySelectorAll("img"))
          .map((i) => i.getAttribute("src") || i.currentSrc || "")
          .filter((s) => s.startsWith("http"));
        return { text, imgs };
      });
      collectedTexts.push(`--- variant: ${label} ---\n${snapshot.text}`);
      for (const u of snapshot.imgs) collectedImageUrls.push(u);
    } catch {
      // unclickable / element detached during click — skip
    }
  }

  console.log(`Clicked ${totalClicked} variant chip(s) by text`);

  // Stash both for the main scrape pass via globals on the page object.
  // Simplest cross-step communication that doesn't disrupt the existing flow.
  (page as unknown as { __variantTexts?: string[]; __variantImgs?: string[] }).__variantTexts =
    collectedTexts;
  (page as unknown as { __variantTexts?: string[]; __variantImgs?: string[] }).__variantImgs =
    collectedImageUrls;
}

async function collectCorpus(page: Page): Promise<string> {
  // Grab inner text from the document — broad net. Filter chrome via the
  // body element's text content; alternatives would be specific selectors,
  // but the page structure isn't known yet.
  const text = await page.evaluate(() => {
    return document.body?.innerText || "";
  });
  return text;
}

async function main() {
  const { url, headless, skipClicks } = parseArgs();
  if (!url) {
    console.error("Usage: npx tsx scripts/_dimension-scanner.ts <url> [--headless] [--no-clicks]");
    console.error("  <url> may be a 1688 detail page OR a teemdrop product page.");
    process.exit(1);
  }
  const email = process.env.TEEMDROP_EMAIL;
  const password = process.env.TEEMDROP_PASSWORD;
  if (!email || !password) {
    console.error("TEEMDROP_EMAIL / TEEMDROP_PASSWORD missing from .env.local");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, email, password);

    // Resolve the input URL → final teemdrop product page.
    let targetUrl: string | null = null;
    if (isOn1688(url)) {
      targetUrl = await searchTeemdropFor1688Url(page, url);
      if (!targetUrl) {
        console.error("\nCould not resolve the 1688 URL to a teemdrop product page. Check the step-* screenshots in scripts/.");
        return;
      }
    } else if (isOnTeemdrop(url)) {
      targetUrl = url;
    } else {
      console.error(`URL "${url}" doesn't look like 1688 or teemdrop. Aborting.`);
      return;
    }

    console.log(`\nNavigating product page: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await snap(page, "08-product-loaded");

    // Dismiss the Logistics Price Adjustment Notice modal — it reappears on
    // every page navigation and blocks the lower half of the product page.
    for (const modalSel of [
      '.ant-modal-wrap button:has-text("Cancel")',
      '[role="dialog"] button:has-text("Cancel")',
      'button:has-text("Cancel")',
      '.ant-modal-close',
    ]) {
      const m = page.locator(modalSel).first();
      if ((await m.count()) > 0 && (await m.isVisible().catch(() => false))) {
        try {
          await m.click({ timeout: 2000 });
          console.log(`  dismissed product-page modal via "${modalSel}"`);
          await page.waitForTimeout(400);
          break;
        } catch {
          // try next
        }
      }
    }

    // Scroll the page in chunks to trigger lazy-loading of the description /
    // attribute table / per-variant rows. Teemdrop's product detail uses
    // intersection-observed sections so all of this content is hidden until
    // the user scrolls past it.
    console.log("\nScrolling to trigger lazy-loaded sections...");
    const scrollHeight = await page.evaluate(() => document.body?.scrollHeight ?? 0);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const y = Math.floor((scrollHeight * i) / steps);
      await page.evaluate((py) => window.scrollTo(0, py), y);
      await page.waitForTimeout(350);
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    await snap(page, "08b-after-scroll");

    if (!skipClicks) {
      console.log("\nClicking variant swatches to surface variant-specific text/images...");
      await clickEveryVariantSwatch(page);
      await page.waitForTimeout(500);
      await snap(page, "09-after-swatches");
    }

    console.log("\nCollecting page text corpus...");
    const pageCorpus = await collectCorpus(page);
    // Merge in per-variant text snapshots captured during the click loop —
    // they're a richer source than the final page state because each click
    // can render variant-specific text that disappears on the next click.
    const variantStash = (page as unknown as { __variantTexts?: string[]; __variantImgs?: string[] });
    const variantTexts = variantStash.__variantTexts ?? [];
    const variantImgs = Array.from(new Set(variantStash.__variantImgs ?? []));
    const corpus = [pageCorpus, ...variantTexts].join("\n\n");
    console.log(`Page corpus: ${pageCorpus.length} chars, +${variantTexts.length} variant snapshot(s), total: ${corpus.length} chars`);
    console.log(`Unique image URLs seen during clicks: ${variantImgs.length}`);

    const hits = extractDimensions(corpus);
    console.log("\n=== DIMENSION HITS ===");
    if (hits.length === 0) {
      console.log("(no dimension annotations found in text)");
      console.log("\nIf the dimensions live ONLY in swatch images, those need OCR — out of scope for v1.");
    } else {
      for (const h of hits) {
        console.log(`  [${h.source}] "${h.match}"`);
        console.log(`    …${h.snippet}…`);
      }
    }

    // Also dump description-region snippets, in case the user wants to eyeball.
    const lower = corpus.toLowerCase();
    const descIdx = lower.indexOf("description");
    if (descIdx >= 0) {
      const slice = corpus.slice(descIdx, descIdx + 1500);
      console.log("\n=== DESCRIPTION SNIPPET (1500 chars from first 'description' label) ===");
      console.log(slice.replace(/\s+/g, " ").trim());
    }

    // Print up to 20 unique image URLs seen during the click loop. The
    // dimension-bearing images that appear after variant clicks live here.
    if (variantImgs.length > 0) {
      console.log("\n=== UNIQUE IMAGE URLs SEEN AFTER VARIANT CLICKS ===");
      for (const u of variantImgs.slice(0, 20)) console.log(`  ${u}`);
      if (variantImgs.length > 20) console.log(`  … and ${variantImgs.length - 20} more`);

      // OCR fallback: when text extraction found nothing, send each unique
      // variant image through Claude Haiku 4.5 vision with a dimension-only
      // prompt. The prompt + parser mirrors the existing swatch-OCR tier in
      // src/services/description-enrichment.service.ts so output looks the
      // same regardless of which entry point fired it.
      if (hits.length === 0) {
        console.log(
          `\n=== OCR FALLBACK — Claude Haiku vision on ${Math.min(variantImgs.length, 20)} unique image(s) ===`,
        );
        const { claudeVision, isClaudeConfigured } = await import(
          "../src/lib/ai/claude-client.js"
        );
        if (!isClaudeConfigured()) {
          console.log("  ANTHROPIC_API_KEY not configured — skipping OCR.");
        } else {
          const SWATCH_DIM_PROMPT = `Look at this product image. Look ONLY for dimension annotations: text labels with measurement units (cm, mm, inch, in, ") next to arrows, brackets, or a labelled diagram. Examples: "28.5cm", "Width 15cm", "L 30 × W 20 × H 15", "直径 12cm", "高 40cm 宽 15cm".

If you find dimension annotations, output ONE LINE in this exact format:
DIMS: <value>

Where <value> is the dimension string normalized to "<L> × <W> × <H> cm" if all three are present, or "<W> × <H> cm" for 2D, or "Diameter <N> cm" for round. Translate Chinese units (厘米 = cm, 毫米 = mm). Don't make up missing values.

If the image has NO dimension annotations, output exactly:
NONE

Output the DIMS or NONE line and nothing else. No preamble, no markdown, no explanation.`;

          // Cap at 20 images so a runaway click loop can't blow up the cost.
          const ocrTargets = variantImgs.slice(0, 20);
          const ocrStart = Date.now();
          const ocrResults = await Promise.all(
            ocrTargets.map(async (url) => {
              try {
                const text = await claudeVision({
                  model: "claude-haiku-4-5",
                  imageUrl: url,
                  prompt: SWATCH_DIM_PROMPT,
                  maxTokens: 64,
                });
                const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
                if (/^NONE\b/i.test(line)) return { url, hit: null };
                const m = line.match(/^DIMS:\s*(.+)$/i);
                return { url, hit: m && m[1].trim() ? m[1].trim() : null };
              } catch (err) {
                return { url, hit: null, err: err instanceof Error ? err.message : String(err) };
              }
            }),
          );
          const took = Date.now() - ocrStart;
          const ocrHits = ocrResults.filter((r) => r.hit);
          console.log(`  ${ocrTargets.length} images OCR'd in ${(took / 1000).toFixed(1)}s — ${ocrHits.length} dimension hit(s)`);
          if (ocrHits.length > 0) {
            for (const r of ocrHits) {
              console.log(`  ✓ ${r.hit}`);
              console.log(`    ${r.url}`);
            }
            const unique = Array.from(new Set(ocrHits.map((r) => r.hit)));
            console.log(`\n  Unique dimensions: ${unique.join(", ")}`);
          } else {
            console.log("  No dimension annotations detected in any image.");
          }
        }
      }
    }
  } catch (err) {
    console.error("\nERROR:", err instanceof Error ? err.message : err);
  } finally {
    if (headless) {
      await browser.close();
    } else {
      console.log("\nBrowser left open for inspection. Close it manually to exit.");
      // Keep the process alive so you can inspect the headed window.
      await new Promise(() => {});
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
