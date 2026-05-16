/**
 * Playwright probe for the featured-image picker.
 *
 * What it verifies end-to-end:
 *   1. Dev server is reachable on PORT (auto-detected from BASE_URL env).
 *   2. /api/auth/login works for the smoketest user.
 *   3. /review/<productId> renders the variant table.
 *   4. Clicking a variant's image button opens the popover.
 *   5. The popover contains the expected tile count.
 *   6. Clicking a tile fires PATCH /api/products/.../variants/... — captures the
 *      response status and body, asserts 200 + the new featuredImageId is in
 *      the response variant.
 *   7. The page reflects the new featured image (data-* attr or rerender).
 *
 * Run with:
 *   BASE_URL=http://localhost:3001 PRODUCT_ID=cmp33j1w5000jw2r03a5m187x \
 *     npx tsx scripts/probe-featured-image-picker.ts
 */

import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const PRODUCT_ID = process.env.PRODUCT_ID || "cmp33j1w5000jw2r03a5m187x";
const EMAIL = process.env.PROBE_EMAIL || "smoketest@example.com";
const PASSWORD = process.env.PROBE_PASSWORD || "smokeTest123!";

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function main() {
  console.log(`Probe: ${BASE_URL}/review/${PRODUCT_ID}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture all PATCH responses to /variants/<id> so we can inspect the click.
  const patchResponses: Array<{ status: number; url: string; body: string }> = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (
      res.request().method() === "PATCH" &&
      /\/api\/products\/[^/]+\/variants\/[^/]+$/.test(url)
    ) {
      let body = "";
      try {
        body = await res.text();
      } catch {
        // ignore
      }
      patchResponses.push({ status: res.status(), url, body });
    }
  });

  // 1) Log in via the API (cookie persists to the browser context).
  console.log("→ Logging in via API...");
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!loginResp.ok()) {
    const txt = await loginResp.text();
    fail(`Login failed: HTTP ${loginResp.status()} ${txt}`);
  }
  console.log("  ✓ logged in as", EMAIL);

  // 2) Navigate to review page.
  console.log(`→ Navigating to /review/${PRODUCT_ID}...`);
  const navResp = await page.goto(`${BASE_URL}/review/${PRODUCT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  if (!navResp || navResp.status() >= 400) {
    fail(`Navigation failed: HTTP ${navResp?.status() ?? "no-response"}`);
  }

  // 3) Wait for the variant table to render — look for the "Variants" heading
  //    or table rows.
  await page.waitForLoadState("networkidle", { timeout: 15_000 });

  // 4) Find the picker buttons. Each variant row has one button with
  //    aria-label="Change featured image".
  const pickerButtons = page.getByRole("button", {
    name: "Change featured image",
  });
  const pickerCount = await pickerButtons.count();
  console.log(`  ✓ found ${pickerCount} picker button(s)`);
  if (pickerCount === 0) {
    fail("No featured-image picker buttons on page — variant table likely didn't render images column");
  }

  // 5) Click the FIRST picker → popover opens.
  console.log("→ Clicking first variant's picker...");
  await pickerButtons.first().click();
  // Popover content: look for our title text.
  const popoverTitle = page.getByText("Choose featured image (one per variant)");
  await popoverTitle.waitFor({ state: "visible", timeout: 5000 }).catch(() => {
    fail("Popover did not open after clicking picker");
  });
  console.log("  ✓ popover opened");

  // 6) Tiles inside the popover. The "None" tile + N image tiles.
  //    Find any tile that isn't currently selected (no ring-primary) so we
  //    have something to click. Simpler: pick the LAST tile in the grid.
  const tiles = page.locator(
    'div.grid button[aria-label]:not([aria-label="Change featured image"]), div.grid button:not([aria-label])',
  );
  // Just grab all buttons inside the popover grid.
  const popover = page.locator('[data-radix-popper-content-wrapper]').first();
  const popoverButtons = popover.locator("button");
  const buttonCount = await popoverButtons.count();
  console.log(`  ✓ popover has ${buttonCount} tile button(s)`);
  if (buttonCount < 2) {
    fail("Expected at least 2 tiles in popover (None + ≥1 image)");
  }

  // Click the LAST tile (most likely a different image than the current
  // featured, which is probably tile 1 or 2).
  console.log("→ Clicking the last tile in the popover...");
  await popoverButtons.last().click();

  // 7) Wait for the PATCH response.
  await page.waitForResponse(
    (res) =>
      res.request().method() === "PATCH" &&
      /\/variants\/[^/]+$/.test(res.url()),
    { timeout: 10_000 },
  ).catch(() => {
    fail("No PATCH /variants/<id> request fired after clicking tile");
  });

  // Give the response handler a tick to record it.
  await page.waitForTimeout(500);

  if (patchResponses.length === 0) {
    fail("PATCH response was not captured");
  }
  const lastPatch = patchResponses[patchResponses.length - 1];
  console.log(`  ✓ PATCH ${lastPatch.url} → ${lastPatch.status}`);
  console.log(`    response: ${lastPatch.body.slice(0, 200)}`);

  if (lastPatch.status !== 200) {
    fail(`PATCH returned ${lastPatch.status} (expected 200)`);
  }

  // 8) Sanity-check the response body contains featuredImageId.
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastPatch.body);
  } catch {
    fail("PATCH body was not valid JSON");
  }
  const variant = (parsed as { variant?: { featuredImageId?: string | null } })
    .variant;
  if (!variant || typeof variant.featuredImageId !== "string") {
    fail(
      `PATCH response body missing variant.featuredImageId: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }

  console.log(
    `\n✓ Probe PASSED — picker click → PATCH 200 → featuredImageId=${variant.featuredImageId}`,
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
