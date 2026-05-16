/**
 * Non-destructive probe for the gallery bulk-delete.
 *
 * Strategy:
 *   1. Insert 2 throwaway ProductImage rows with unique fileNames.
 *   2. Navigate to /review/<productId>.
 *   3. Find the 2 throwaway tiles by their fileNames (the alt text or aria).
 *   4. Check both checkboxes.
 *   5. Click "Delete selected (2)" → auto-accept the confirm dialog.
 *   6. Wait for DELETEs.
 *   7. Assert via DB that the throwaway rows are gone.
 *   8. If any remain (test failure path), DB-cleanup before exit.
 *
 * No real user data is touched. The throwaway rows are the entire test surface.
 *
 * Env:
 *   BASE_URL, PRODUCT_ID, PROBE_EMAIL, PROBE_PASSWORD
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import pg from "pg";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}
loadEnvLocal();

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const PRODUCT_ID = process.env.PRODUCT_ID!;
const EMAIL = process.env.PROBE_EMAIL!;
const PASSWORD = process.env.PROBE_PASSWORD!;

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function main() {
  if (!PRODUCT_ID || !EMAIL || !PASSWORD) {
    fail("Set PRODUCT_ID, PROBE_EMAIL, PROBE_PASSWORD");
  }

  const stamp = Date.now();
  const tag1 = `__probe_bulk_${stamp}_a`;
  const tag2 = `__probe_bulk_${stamp}_b`;

  const pgClient = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await pgClient.connect();

  // 1. Insert 2 throwaway rows. Use a transparent 1x1 png URL so the <img> tag
  //    in the gallery doesn't 404-spam the console.
  const placeholderUrl =
    "https://via.placeholder.com/200x200.png?text=probe";
  await pgClient.query(
    `INSERT INTO scraper_1688."ProductImage" (id, "productId", "sourceUrl", "storagePath", "fileName", "altText", position, "downloadStatus", "createdAt")
     VALUES
       (gen_random_uuid()::text, $1, $2, $3, $4, $5, 9990, 'downloaded', NOW()),
       (gen_random_uuid()::text, $1, $2, $6, $7, $8, 9991, 'downloaded', NOW())`,
    [
      PRODUCT_ID,
      placeholderUrl,
      `probe/${tag1}.png`,
      `${tag1}.png`,
      `Probe alt ${tag1}`,
      `probe/${tag2}.png`,
      `${tag2}.png`,
      `Probe alt ${tag2}`,
    ],
  );
  console.log(`  ✓ inserted 2 throwaway rows (${tag1}, ${tag2})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Auto-accept the confirm dialog when bulk-delete fires.
  page.on("dialog", async (d) => {
    await d.accept();
  });

  // Log in
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!loginResp.ok()) fail(`Login failed: HTTP ${loginResp.status()}`);

  // Visit the review page
  const navResp = await page.goto(`${BASE_URL}/review/${PRODUCT_ID}`, {
    waitUntil: "domcontentloaded",
  });
  if (!navResp || navResp.status() >= 400) {
    fail(`Navigation failed: HTTP ${navResp?.status() ?? "none"}`);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 });

  // Find the 2 throwaway tiles via their alt text.
  const tile1 = page.locator(`img[alt="Probe alt ${tag1}"]`);
  const tile2 = page.locator(`img[alt="Probe alt ${tag2}"]`);
  const tile1Count = await tile1.count();
  const tile2Count = await tile2.count();
  if (tile1Count === 0 || tile2Count === 0) {
    fail(`Probe tiles not found on page (a=${tile1Count} b=${tile2Count})`);
  }
  console.log(`  ✓ both throwaway tiles visible`);

  // Click the checkbox inside each tile's parent <div>.
  // Each tile's tree: <div tile> -> <div abs checkbox>, <div aspect-square> -> img
  // Walk up to the tile root then find the checkbox.
  async function checkTile(altRegexLiteral: string) {
    const img = page.locator(`img[alt="${altRegexLiteral}"]`).first();
    // Ancestor with the checkbox is 2 levels up.
    const tileRoot = img.locator("xpath=ancestor::div[contains(@class, 'group')][1]");
    const checkbox = tileRoot.locator('button[role="checkbox"]');
    await checkbox.click();
  }
  await checkTile(`Probe alt ${tag1}`);
  await checkTile(`Probe alt ${tag2}`);

  // Now the toolbar should show "2 images selected"
  const toolbar = page.getByText(/^\d+ image(s)? selected/);
  await toolbar.waitFor({ state: "visible", timeout: 3000 });
  console.log(`  ✓ bulk toolbar visible (${await toolbar.innerText()})`);

  // Click delete
  const deleteBtn = page.getByRole("button", { name: /Delete selected/ });
  await deleteBtn.click();

  // Wait for DELETE responses
  await page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" &&
      /\/api\/products\/[^/]+\/images\/[^/]+$/.test(r.url()),
    { timeout: 10_000 },
  );
  // Give the rest of the parallel deletes a moment
  await page.waitForTimeout(1500);

  // Verify via DB
  const remaining = await pgClient.query(
    `SELECT id FROM scraper_1688."ProductImage" WHERE "productId" = $1 AND ("fileName" = $2 OR "fileName" = $3)`,
    [PRODUCT_ID, `${tag1}.png`, `${tag2}.png`],
  );
  if (remaining.rows.length > 0) {
    // Cleanup so the next probe run isn't polluted.
    await pgClient.query(
      `DELETE FROM scraper_1688."ProductImage" WHERE "productId" = $1 AND ("fileName" = $2 OR "fileName" = $3)`,
      [PRODUCT_ID, `${tag1}.png`, `${tag2}.png`],
    );
    fail(
      `Bulk delete left ${remaining.rows.length} row(s) behind (cleaned them up manually)`,
    );
  }

  console.log(`\n✓ Probe PASSED — 2 throwaway rows deleted via bulk-delete UI`);
  await browser.close();
  await pgClient.end();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
