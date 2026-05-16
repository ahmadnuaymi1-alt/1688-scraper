/**
 * Playwright probe — verifies:
 *  1. /review/<productId> renders with the user logged in.
 *  2. Every variant row has a visible image thumbnail (NOT a "-" placeholder).
 *  3. Clicking a picker opens the popover.
 *  4. Clicking a tile fires PATCH 200.
 *  5. Image gallery section is deduped (≤ unique files, not the full DB row count).
 *
 * Env vars:
 *   BASE_URL, PRODUCT_ID, PROBE_EMAIL, PROBE_PASSWORD
 */

import { chromium } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const PRODUCT_ID = process.env.PRODUCT_ID!;
const EMAIL = process.env.PROBE_EMAIL!;
const PASSWORD = process.env.PROBE_PASSWORD!;
const EXPECTED_UNIQUE_FILES = Number(process.env.EXPECTED_UNIQUE_FILES || "9");

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function main() {
  if (!PRODUCT_ID || !EMAIL || !PASSWORD) {
    fail("Set PRODUCT_ID, PROBE_EMAIL, PROBE_PASSWORD");
  }
  console.log(`Probe: ${BASE_URL}/review/${PRODUCT_ID} as ${EMAIL}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const patchResponses: Array<{ status: number; url: string; body: string }> = [];
  page.on("response", async (res) => {
    if (
      res.request().method() === "PATCH" &&
      /\/api\/products\/[^/]+\/variants\/[^/]+$/.test(res.url())
    ) {
      let body = "";
      try {
        body = await res.text();
      } catch {}
      patchResponses.push({ status: res.status(), url: res.url(), body });
    }
  });

  // 1. Login
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!loginResp.ok()) {
    fail(`Login failed: HTTP ${loginResp.status()} ${await loginResp.text()}`);
  }
  console.log("  ✓ logged in");

  // 2. Navigate
  const navResp = await page.goto(`${BASE_URL}/review/${PRODUCT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  if (!navResp || navResp.status() >= 400) {
    fail(`Navigation failed: HTTP ${navResp?.status() ?? "no-response"}`);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 });

  // 3. Picker buttons exist
  const pickerButtons = page.getByRole("button", { name: "Change featured image" });
  const pickerCount = await pickerButtons.count();
  console.log(`  ✓ ${pickerCount} picker button(s)`);
  if (pickerCount < 8) fail(`Expected ≥8 picker buttons, got ${pickerCount}`);

  // 4. Every picker button must contain an <img> (NOT a "-" placeholder)
  //    Count how many have an img child.
  let withImg = 0;
  let blankPickers: string[] = [];
  for (let i = 0; i < pickerCount; i++) {
    const btn = pickerButtons.nth(i);
    const hasImg = (await btn.locator("img").count()) > 0;
    if (hasImg) {
      withImg++;
    } else {
      const rowText = await btn
        .locator("xpath=ancestor::tr[1]")
        .innerText()
        .catch(() => "?");
      blankPickers.push(rowText.replace(/\s+/g, " ").slice(0, 80));
    }
  }
  console.log(`  ✓ ${withImg}/${pickerCount} picker(s) show a thumbnail`);
  if (blankPickers.length > 0) {
    console.log("  Blank rows:");
    for (const r of blankPickers) console.log(`    - ${r}`);
    fail(`Expected every visible variant to show a thumbnail`);
  }

  // 5. Capture the FIRST variant's current featuredImageId so we can restore
  //    it after the test click — probes must not mutate real product data.
  console.log("→ Capturing variant #1's current featuredImageId for restore...");
  const variantsBefore = await context.request.get(
    `${BASE_URL}/api/products/${PRODUCT_ID}/variants`,
  );
  const variantsBeforeJson = (await variantsBefore.json()) as {
    variants?: Array<{ id: string; position: number; featuredImageId: string | null }>;
  };
  const firstVariant = (variantsBeforeJson.variants || []).find((v) => v.position === 1);
  const originalFeaturedId = firstVariant?.featuredImageId ?? null;
  console.log(`  ✓ original featuredImageId for variant #1: ${originalFeaturedId}`);

  // 6. Click first picker → popover opens
  await pickerButtons.first().click();
  await page.getByText("Choose featured image (one per variant)").waitFor({
    state: "visible",
    timeout: 5000,
  });
  console.log("  ✓ popover opened");

  // 7. Count tiles in popover (should be ~ unique files + 1 None tile)
  const popover = page.locator("[data-radix-popper-content-wrapper]").first();
  const tiles = popover.locator("button");
  const tileCount = await tiles.count();
  console.log(`  ✓ ${tileCount} tiles in popover (expected ~${EXPECTED_UNIQUE_FILES + 1})`);

  // 8. Click last tile → PATCH 200
  await tiles.last().click();
  await page
    .waitForResponse(
      (res) =>
        res.request().method() === "PATCH" &&
        /\/variants\/[^/]+$/.test(res.url()),
      { timeout: 10_000 },
    )
    .catch(() => fail("No PATCH after tile click"));
  await page.waitForTimeout(500);
  const lastPatch = patchResponses[patchResponses.length - 1];
  if (lastPatch.status !== 200) {
    fail(`PATCH returned ${lastPatch.status}: ${lastPatch.body.slice(0, 200)}`);
  }
  console.log(`  ✓ PATCH 200 (variant updated)`);

  // 9. RESTORE the original featuredImageId so the probe leaves no trace.
  if (firstVariant) {
    const restoreResp = await context.request.patch(
      `${BASE_URL}/api/products/${PRODUCT_ID}/variants/${firstVariant.id}`,
      {
        data: { featuredImageId: originalFeaturedId },
      },
    );
    if (!restoreResp.ok()) {
      fail(`Restore PATCH failed: HTTP ${restoreResp.status()}`);
    }
    console.log(`  ✓ restored variant #1's featuredImageId`);
  }

  // 8. Close popover and check gallery tile count
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // The gallery section uses a heading "Images" — find tile count below it.
  const galleryHeading = page.getByRole("heading", { name: /^Images$/i });
  await galleryHeading.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  // Each gallery card has a "Set primary" button — count those.
  const galleryTiles = page.getByRole("button", { name: /Set primary/i });
  const galleryTileCount = await galleryTiles.count();
  console.log(`  ✓ ${galleryTileCount} gallery tile(s) (expected ~${EXPECTED_UNIQUE_FILES})`);
  if (galleryTileCount > EXPECTED_UNIQUE_FILES + 2) {
    fail(
      `Gallery shows ${galleryTileCount} tiles; expected ≤${EXPECTED_UNIQUE_FILES + 2} (dedup should collapse sister-rows)`,
    );
  }

  console.log(`\n✓ Probe PASSED`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
