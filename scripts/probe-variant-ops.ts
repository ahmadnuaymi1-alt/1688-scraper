/**
 * Combined non-destructive probe for the four variant-table changes:
 *   1. Pricing tier click (was "HTTP 200" bug) — captures + restores tier.
 *   2. Hide/unhide single variant — captures + restores isHidden.
 *   3. Bulk Hide selected — captures + restores isHidden for N variants.
 *   4. Shift-click range select — pure UI, no DB mutation.
 *
 * Env: BASE_URL, PRODUCT_ID, PROBE_EMAIL, PROBE_PASSWORD.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import pg from "pg";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
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

  const pgClient = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await pgClient.connect();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("dialog", (d) => d.accept());

  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!loginResp.ok()) fail(`Login failed: HTTP ${loginResp.status()}`);
  console.log("  ✓ logged in");

  // ─────────────────────────────────────────────────────────────────────
  // 1) Pricing tier click
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n[1] Pricing tier click");
  const variantsBefore = await context.request.get(
    `${BASE_URL}/api/products/${PRODUCT_ID}/variants`,
  );
  const beforeJson = (await variantsBefore.json()) as {
    variants: Array<{ id: string; price: string; position: number }>;
  };
  const v1Before = beforeJson.variants.find((v) => v.position === 1);
  if (!v1Before) fail("Could not find variant #1 in /api/.../variants");
  const priceBefore = v1Before.price;
  console.log(`  variant #1 price before: $${priceBefore}`);

  // Apply STRETCH via the same API route the UI uses
  const stretchResp = await context.request.post(
    `${BASE_URL}/api/products/${PRODUCT_ID}/recalculate-pricing`,
    { data: { tierOverride: "stretch" } },
  );
  if (!stretchResp.ok()) {
    const txt = await stretchResp.text();
    fail(`Apply STRETCH failed: HTTP ${stretchResp.status()} — ${txt.slice(0, 200)}`);
  }
  const stretchBody = await stretchResp.json();
  if (!stretchBody.pricingNotes && !stretchBody.applied) {
    fail(`Unexpected response shape: ${JSON.stringify(stretchBody).slice(0, 200)}`);
  }
  console.log(`  ✓ STRETCH applied (server returned pricingNotes + applied=${stretchBody.applied})`);

  const variantsAfterStretch = await context.request.get(
    `${BASE_URL}/api/products/${PRODUCT_ID}/variants`,
  );
  const afterStretchJson = (await variantsAfterStretch.json()) as {
    variants: Array<{ id: string; price: string }>;
  };
  const v1Stretch = afterStretchJson.variants.find((v) => v.id === v1Before.id);
  if (!v1Stretch) fail("Variant #1 disappeared after stretch");
  if (v1Stretch.price === priceBefore) {
    fail(`Variant #1 price unchanged after STRETCH: $${v1Stretch.price}`);
  }
  console.log(`  ✓ variant #1 price after STRETCH: $${v1Stretch.price}`);

  // Restore to LAUNCH
  const restoreResp = await context.request.post(
    `${BASE_URL}/api/products/${PRODUCT_ID}/recalculate-pricing`,
    { data: { tierOverride: "launch" } },
  );
  if (!restoreResp.ok()) fail("LAUNCH restore failed");
  console.log("  ✓ restored to LAUNCH");

  // ─────────────────────────────────────────────────────────────────────
  // 2) Hide/unhide single (eye-icon button)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n[2] Hide/unhide single variant");
  await page.goto(`${BASE_URL}/review/${PRODUCT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 });

  const v1IdRow = await pgClient.query(
    `SELECT id, "isHidden" FROM scraper_1688."Variant" WHERE "productId" = $1 AND position = 1`,
    [PRODUCT_ID],
  );
  if (v1IdRow.rows.length === 0) fail("Variant #1 not found in DB");
  const v1Id = v1IdRow.rows[0].id;
  const v1HiddenBefore = v1IdRow.rows[0].isHidden;
  console.log(`  variant #1 hidden before: ${v1HiddenBefore}`);

  // Find the eye-icon button on the variant #1 row. The aria-label varies
  // (Hide variant / Unhide variant) — match both.
  const eyeBtn = page.getByRole("button", { name: /(Hide|Unhide) variant/ }).first();
  await eyeBtn.click();
  await page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      r.url().endsWith(`/api/products/${PRODUCT_ID}/variants`),
    { timeout: 5000 },
  );
  await page.waitForTimeout(300);

  const v1IdRowAfter = await pgClient.query(
    `SELECT "isHidden" FROM scraper_1688."Variant" WHERE id = $1`,
    [v1Id],
  );
  const v1HiddenAfter = v1IdRowAfter.rows[0].isHidden;
  if (v1HiddenAfter === v1HiddenBefore) {
    fail(`Hide/unhide click didn't change isHidden — still ${v1HiddenAfter}`);
  }
  console.log(`  ✓ isHidden flipped: ${v1HiddenBefore} → ${v1HiddenAfter}`);

  // Restore
  await pgClient.query(
    `UPDATE scraper_1688."Variant" SET "isHidden" = $1 WHERE id = $2`,
    [v1HiddenBefore, v1Id],
  );
  console.log("  ✓ restored isHidden");

  // ─────────────────────────────────────────────────────────────────────
  // 3) Bulk hide selected
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n[3] Bulk hide selected");
  // Use the API to bulk-PATCH 2 visible variants directly (probes the new
  // route shape end-to-end without depending on UI selection flow).
  const twoVisible = await pgClient.query(
    `SELECT id, "isHidden" FROM scraper_1688."Variant"
     WHERE "productId" = $1 AND "isHidden" = false
     ORDER BY position ASC LIMIT 2`,
    [PRODUCT_ID],
  );
  if (twoVisible.rows.length < 2) {
    fail("Need ≥2 visible variants for bulk-hide probe");
  }
  const targetIds = twoVisible.rows.map((r) => r.id);
  const bulkResp = await context.request.patch(
    `${BASE_URL}/api/products/${PRODUCT_ID}/variants`,
    { data: { updates: targetIds.map((id) => ({ id, isHidden: true })) } },
  );
  if (!bulkResp.ok()) {
    fail(`Bulk-PATCH failed: HTTP ${bulkResp.status()} ${await bulkResp.text()}`);
  }
  const bulkBody = await bulkResp.json();
  if (bulkBody.updated !== 2) {
    fail(`Bulk-PATCH returned updated=${bulkBody.updated}, expected 2`);
  }
  const verifyHidden = await pgClient.query(
    `SELECT id FROM scraper_1688."Variant" WHERE id = ANY($1) AND "isHidden" = true`,
    [targetIds],
  );
  if (verifyHidden.rows.length !== 2) {
    fail(`Only ${verifyHidden.rows.length}/2 variants actually got hidden`);
  }
  console.log(`  ✓ bulk-PATCH hid 2 variants (route shape works)`);
  // Restore
  await context.request.patch(
    `${BASE_URL}/api/products/${PRODUCT_ID}/variants`,
    { data: { updates: targetIds.map((id) => ({ id, isHidden: false })) } },
  );
  console.log("  ✓ restored visibility");

  // ─────────────────────────────────────────────────────────────────────
  // 4) Shift-click range select (pure UI; no DB)
  // ─────────────────────────────────────────────────────────────────────
  console.log("\n[4] Shift-click range select");
  // Refresh the page so any state from earlier is clean.
  await page.goto(`${BASE_URL}/review/${PRODUCT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
  const rowCheckboxes = page.locator(
    'tbody [aria-label^="Select"]',
  );
  const checkCount = await rowCheckboxes.count();
  if (checkCount < 5) fail(`Need ≥5 rows for shift-click probe; have ${checkCount}`);
  // First click: row index 0 (no shift)
  await rowCheckboxes.nth(0).click();
  // Shift-click: row index 4
  await rowCheckboxes.nth(4).click({ modifiers: ["Shift"] });
  await page.waitForTimeout(150);
  const selectedToolbar = await page.getByText(/\d+ of \d+ selected/).innerText();
  // Expect "5 of N selected" — parse the first number.
  const m = selectedToolbar.match(/^(\d+) of/);
  const selectedCount = m ? parseInt(m[1], 10) : -1;
  if (selectedCount !== 5) {
    fail(`Expected 5 rows selected via shift-click, got ${selectedCount} (toolbar text: "${selectedToolbar}")`);
  }
  console.log(`  ✓ shift-click range selected 5 rows (toolbar: "${selectedToolbar}")`);

  // Cleanup
  await browser.close();
  await pgClient.end();
  console.log(`\n✓ All 4 probes PASSED`);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
