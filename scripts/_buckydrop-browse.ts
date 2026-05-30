/**
 * Open Buckydrop in a headed, persistent Chromium session, navigate to the
 * sourcing page, optionally type a search query, and capture screenshots +
 * structured product-card data for the LLM to evaluate.
 *
 * Why headed + persistent profile: Buckydrop has a login wall and bot
 * detection. The first run will land on the login page — log in manually in
 * the visible window once, then close it. Subsequent runs reuse the same
 * cookies (stored in TEMP/scene/buckydrop-session) so login isn't needed
 * again until cookies expire.
 *
 * Usage:
 *   npx tsx scripts/_buckydrop-browse.ts                       # phase 1: just open the page
 *   npx tsx scripts/_buckydrop-browse.ts --search "wall lamp"  # phase 2: search + screenshot
 *   npx tsx scripts/_buckydrop-browse.ts --keep-open           # leave the window open after
 *
 * Screenshots land in scripts/_buckydrop-*.png.
 * If a search runs, scripts/_buckydrop-products.json gets the extracted card
 * data (title, price, orders count, link, thumbnail URL) for each product
 * visible on the results page.
 */

import fs from "node:fs";
import os from "node:os";
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

function getArg(name: string): string | undefined {
  const i = process.argv.findIndex((a) => a === `--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}
const keepOpen = process.argv.includes("--keep-open");
const searchQuery = getArg("search");

const PROFILE_DIR = path.join(os.tmpdir(), "scene", "buckydrop-session");
const HOME_URL = "https://www.buckydrop.com/en/sourcing/";
const SCREENSHOT_DIR = "scripts";

async function snap(page: Page, label: string) {
  const file = path.join(SCREENSHOT_DIR, `_buckydrop-${label}.png`);
  try {
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  📸 ${file}`);
  } catch (e) {
    console.log(`  (screenshot ${label} failed: ${e instanceof Error ? e.message : e})`);
  }
}

async function waitABit(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function tryFindSearchBox(page: Page) {
  // Try a few common selectors for a top-of-page search input.
  const selectors = [
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[placeholder*="keyword" i]',
    'input[placeholder*="product" i]',
    '.search-input input',
    '.search-bar input',
    'header input',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    const count = await loc.count();
    if (count > 0) {
      try {
        await loc.waitFor({ state: "visible", timeout: 2_000 });
        return { loc, selector: sel };
      } catch {
        // try next
      }
    }
  }
  return null;
}

interface ProductCard {
  title: string;
  price: string;
  orders: string;
  link: string;
  thumbnail: string;
}

/**
 * Best-effort extraction of product cards from the visible DOM. Buckydrop's
 * markup is unknown to me, so this uses generic heuristics: look for repeated
 * sibling containers that each have an image + a price-looking string.
 * If you read this and the JSON is empty, the selectors below need adjusting
 * after looking at the screenshot.
 */
async function extractProductCards(page: Page): Promise<ProductCard[]> {
  return await page.evaluate(() => {
    // Buckydrop uses `.product` as the per-card container. Within each:
    //   .product-image img             → thumbnail
    //   .product-name .truncate        → title
    //   .text-red span:last-child      → price number (preceded by "CN ¥")
    //   any text node matching /\d+K\+?/ → sold count
    const cardEls = Array.from(document.querySelectorAll(".product")) as HTMLElement[];
    return cardEls.map((card) => {
      const img = card.querySelector(".product-image img") as HTMLImageElement | null;
      const titleEl =
        card.querySelector(".product-name .truncate") ||
        card.querySelector(".product-name");
      const priceEl = card.querySelector(".text-red") as HTMLElement | null;
      const fullText = (card.innerText ?? "").replace(/\s+/g, " ").trim();
      const ordersMatch = fullText.match(/(\d+(?:\.\d+)?[kK]\+?)(?=\s|$)/);
      // Link: card might be wrapped in <a>, or have a router-link child, or
      // have a data-id attribute we can build a URL from.
      let link = "";
      const anchor = card.closest("a") || card.querySelector("a");
      if (anchor instanceof HTMLAnchorElement && anchor.href) link = anchor.href;
      const dataId =
        card.getAttribute("data-id") ||
        card.getAttribute("data-product-id") ||
        "";
      return {
        title: (titleEl?.textContent ?? "").trim().slice(0, 200),
        price: (priceEl?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
        orders: ordersMatch ? ordersMatch[1] : "",
        link: link || dataId,
        thumbnail: img?.src || img?.getAttribute("data-src") || "",
      };
    }).filter((c) => c.title);
  });
}

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  console.log(`Launching headed Chromium with profile: ${PROFILE_DIR}`);
  console.log(`  (first run: log into Buckydrop manually in the window, then re-run)`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    // Minor stealth — use a normal-looking UA.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = context.pages()[0] ?? (await context.newPage());

  console.log(`\nNavigating to: ${HOME_URL}`);
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitABit(3_000);
  await snap(page, "01-sourcing-page");

  const currentUrl = page.url();
  console.log(`Landed at: ${currentUrl}`);
  const bodyText = await page.evaluate(() => document.body?.innerText.slice(0, 400) ?? "");
  console.log(`Body head: ${bodyText.replace(/\s+/g, " ").trim().slice(0, 300)}`);

  // If we got bounced to a login URL, stop and tell the user.
  if (/login|sign-in|sign_in/i.test(currentUrl)) {
    console.log(`\n⚠ Looks like Buckydrop redirected to a login URL.`);
    console.log(`  Log in manually in the visible browser window, then close it.`);
    console.log(`  Next run will reuse the cookies. Re-run with --search "<query>" once logged in.`);
    if (!keepOpen) {
      console.log(`  Window will stay open for 5 minutes so you can log in.`);
      await waitABit(5 * 60 * 1000);
    } else {
      console.log(`  --keep-open: window staying open. Close it when done.`);
      await new Promise(() => {});
    }
    await context.close();
    return;
  }

  // Try the search flow if asked.
  if (searchQuery) {
    console.log(`\nLooking for search box to search: "${searchQuery}"`);
    const found = await tryFindSearchBox(page);
    if (!found) {
      console.log(`  Could not find a search input with common selectors.`);
      console.log(`  Take a look at scripts/_buckydrop-01-sourcing-page.png and tell me the layout.`);
    } else {
      console.log(`  Found search input: ${found.selector}`);
      // Click first to focus, then type (some Vue/React inputs ignore fill()
      // because they're wrapped in custom-event components).
      await found.loc.scrollIntoViewIfNeeded().catch(() => null);
      await found.loc.click({ timeout: 10_000 });
      await waitABit(300);
      // Clear any pre-existing value, then type the query character by character.
      await page.keyboard.press("Control+A").catch(() => null);
      await page.keyboard.press("Delete").catch(() => null);
      await page.keyboard.type(searchQuery, { delay: 30 });
      await waitABit(500);
      await snap(page, "02a-search-typed");
      await page.keyboard.press("Enter");
      console.log(`  Submitted query. Waiting for results to render...`);
      await waitABit(5_000);
      await snap(page, "02-search-results");

      // Try clicking a "sort by orders/sales" control if one exists. The
      // first screenshot showed a row of sort tabs ("Supply Sources", "Sales",
      // "Newest", "General Ranking", "Price Ranking"). "Sales" or "Orders" is
      // what we want.
      const sortClicked = await page
        .locator(
          "text=/^\\s*(Sales|Sales Volume|Orders|Sold|General Ranking)\\s*$/i",
        )
        .first()
        .click({ timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (sortClicked) {
        console.log(`  clicked sort control`);
        await waitABit(3_000);
      } else {
        console.log(`  no obvious sort control found — using default order`);
      }
      await snap(page, "02b-after-sort");

      // Scroll once to make sure the lazy-load fires (the listing has a
      // virtualizer that only renders rows as they enter the viewport).
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85));
      await waitABit(1500);
      await snap(page, `03-scrolled`);

      // Debug: dump the outerHTML of the first card-shaped element so we can
      // see the real DOM structure and improve the extractor selectors.
      const debugHtml = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
        const productImg = imgs.find((i) => /cbu01\.alicdn\.com/.test(i.src));
        if (!productImg) return "(no alicdn img found)";
        let node: Element | null = productImg;
        for (let d = 0; d < 8 && node; d++) {
          const t = (node as HTMLElement).innerText ?? "";
          if (t.length > 30) return (node as HTMLElement).outerHTML.slice(0, 4000);
          node = node.parentElement;
        }
        return productImg.outerHTML;
      });
      fs.writeFileSync(path.join(SCREENSHOT_DIR, "_buckydrop-card-debug.html"), debugHtml);
      console.log(`  wrote scripts/_buckydrop-card-debug.html (${debugHtml.length} bytes)`);

      const cards = await extractProductCards(page);
      console.log(`\nExtracted ${cards.length} product card(s).`);

      // Click each card in turn, capture the URL of the new tab that opens
      // (Buckydrop opens products as popups, not in-tab nav). Cap at 20 so
      // the run doesn't take forever. Buckydrop's product detail page either
      // is the 1688 URL itself or has the offer ID in its URL.
      const captureCount = Math.min(20, cards.length);
      console.log(`\nCapturing URLs for first ${captureCount} cards via click...`);
      // Scroll back to the top so the first cards are in view + clickable.
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitABit(800);
      const cardLocators = await page.locator(".product").all();
      const captured: Array<{ index: number; title: string; sourceUrl: string }> = [];
      for (let i = 0; i < Math.min(captureCount, cardLocators.length); i++) {
        const cardLoc = cardLocators[i];
        let title = "";
        try {
          title = (await cardLoc.locator(".product-name").innerText({ timeout: 2_000 })).trim();
        } catch { /* */ }

        await cardLoc.scrollIntoViewIfNeeded().catch(() => null);
        const [newPage] = await Promise.all([
          context.waitForEvent("page", { timeout: 8_000 }).catch(() => null),
          cardLoc.click({ timeout: 8_000 }).catch(() => null),
        ]);

        let sourceUrl = "";
        if (newPage) {
          await newPage.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => null);
          // Let the SKU / variant section render in.
          await newPage.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => null);
          await new Promise((r) => setTimeout(r, 2_000));
          sourceUrl = newPage.url();
          // Screenshot the variant section of the detail page. Scroll a bit
          // first because Buckydrop puts SKU controls below the gallery.
          try {
            await newPage.evaluate(() => window.scrollTo(0, 400));
            await new Promise((r) => setTimeout(r, 600));
            await newPage.screenshot({
              path: path.join(
                SCREENSHOT_DIR,
                `_buckydrop-detail-${String(i + 1).padStart(2, "0")}.png`,
              ),
              fullPage: false,
            });
          } catch { /* */ }
          await newPage.close().catch(() => null);
        } else {
          const u = page.url();
          if (u !== HOME_URL && !/\/sourcing\/?$/.test(u)) {
            sourceUrl = u;
            await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
            await waitABit(500);
          }
        }

        console.log(`  [${i + 1}/${captureCount}] "${title.slice(0, 60)}"`);
        console.log(`        url: ${sourceUrl || "(no url captured)"}`);
        captured.push({ index: i, title, sourceUrl });
        await waitABit(400);
      }

      // Merge captured URLs into the cards data by index.
      for (const c of captured) {
        if (cards[c.index]) cards[c.index].link = c.sourceUrl;
      }
      const outPath = path.join(SCREENSHOT_DIR, "_buckydrop-products.json");
      fs.writeFileSync(outPath, JSON.stringify(cards, null, 2));
      console.log(`  wrote ${outPath}`);
      // Print first 5 as a quick preview.
      for (const c of cards.slice(0, 5)) {
        console.log(`  - "${c.title}"  ${c.price}  [${c.orders}]  ${c.link.slice(0, 80)}`);
      }
    }
  }

  if (keepOpen) {
    console.log(`\n--keep-open set. Window staying open. Ctrl-C when done.`);
    await new Promise(() => {});
  } else {
    console.log(`\nClosing browser. Use --keep-open to inspect manually.`);
    await context.close();
  }
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
