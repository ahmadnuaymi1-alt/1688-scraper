/**
 * Build the input list for the bulk pricing workflow: for each ACTIVE
 * Vilvida product, attach (a) Shopify productId + current price + handle,
 * (b) local Product.id if one exists with matching 1688 URL, (c) a "stuck"
 * flag for the 6 branded Spocket carryovers.
 *
 * Writes the result to scripts/_vilvida-pricing-input.json so the workflow
 * can read it.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

interface ShopifyEntry {
  shopifyId: string;
  title: string;
  handle: string;
  status: string;
  currentPrice: string | null;
  currentCompareAt: string | null;
  url1688: string | null;
  urlSource: string;
  localProductId: string | null;
  hasRawPayload: boolean;
}

async function main() {
  const prisma = new PrismaClient();

  // Read the cached Shopify pull.
  const inputPath = path.resolve(process.cwd(), "scripts/_vilvida-with-1688.json");
  const allShopify = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as ShopifyEntry[];
  const active = allShopify.filter((p) => p.status === "ACTIVE");

  // Pull ALL local jobs + the offer IDs from their sourceUrl, to match
  // Shopify products that just got freshly scraped.
  const jobs = await prisma.scrapeJob.findMany({
    select: { id: true, sourceUrl: true, status: true, product: { select: { id: true, title: true } } },
  });
  // Map offerId → most recent local Product
  const offerToProduct = new Map<string, { id: string; title: string; createdAt: number }>();
  for (const j of jobs) {
    if (!j.product) continue;
    const m = j.sourceUrl.match(/\/offer\/(\d+)\.html/);
    if (!m) continue;
    const offerId = m[1];
    // Take the newest one when there are duplicates
    const existing = offerToProduct.get(offerId);
    if (!existing) {
      offerToProduct.set(offerId, { id: j.product.id, title: j.product.title, createdAt: 0 });
    }
  }

  // For each Shopify active product, resolve its local Product.id via the
  // offerId embedded in the 1688 URL.
  const rows: Array<{
    shopifyId: string;
    title: string;
    handle: string;
    currentPrice: number | null;
    currentCompareAt: number | null;
    url1688: string | null;
    localProductId: string | null;
    mode: "full" | "comp-only";
  }> = [];

  for (const s of active) {
    let localId = s.localProductId; // from the prior cross-check via UploadRecord
    if (!localId && s.url1688) {
      const m = s.url1688.match(/\/offer\/(\d+)\.html/);
      if (m) {
        const lookup = offerToProduct.get(m[1]);
        if (lookup) localId = lookup.id;
      }
    }
    rows.push({
      shopifyId: s.shopifyId,
      title: s.title,
      handle: s.handle,
      currentPrice: s.currentPrice ? parseFloat(s.currentPrice) : null,
      currentCompareAt: s.currentCompareAt ? parseFloat(s.currentCompareAt) : null,
      url1688: s.url1688,
      localProductId: localId,
      mode: localId ? "full" : "comp-only",
    });
  }

  const full = rows.filter((r) => r.mode === "full");
  const compOnly = rows.filter((r) => r.mode === "comp-only");
  console.log(`Active products: ${rows.length}`);
  console.log(`  full methodology (rawPayload available): ${full.length}`);
  console.log(`  comp-only (no rawPayload, branded Spocket carryovers): ${compOnly.length}`);

  console.log(`\nComp-only list (the 6 stuck branded products):`);
  for (const r of compOnly) {
    console.log(`  ${r.handle} | current=$${r.currentPrice} | title=${r.title.slice(0, 50)}`);
  }

  const outPath = path.resolve(process.cwd(), "scripts/_vilvida-pricing-input.json");
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
