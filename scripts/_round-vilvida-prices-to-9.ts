/**
 * Round every variant's price on the Vilvida Shopify store to the nearest whole
 * dollar ending in 9 (e.g. $137 → $139, $131 → $129, $130 → $129). On a tie at
 * the .50 midpoint, JS Math.round rounds toward +∞, i.e. up to the higher 9.
 * Also wipes compareAtPrice (sets to null) on every variant.
 *
 * Strategy:
 *   1. Mint a fresh Shopify Admin token from the Vilvida ShopifyConnection
 *      (clientId/clientSecret via OAuth client_credentials grant) — old tokens
 *      expire at 24h on shpca_, so always refresh.
 *   2. Page through ALL products + their variants via Admin GraphQL.
 *   3. Compute the rounded price for each variant. Skip variants where price
 *      already matches (no-op) AND compareAtPrice is already null.
 *   4. Fan out productVariantsBulkUpdate calls across products in batches of 5
 *      concurrent mutations (Shopify rate limit safety).
 *   5. Report total products touched + variants changed.
 *
 * Safety:
 *   - --dry-run flag prints the planned changes without applying them.
 *   - Per-product diff is printed in real time so you can Ctrl+C mid-run if it
 *     looks wrong.
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

const DRY_RUN = process.argv.includes("--dry-run");
const CONCURRENCY = 5;

/** Round price P (USD) to the nearest integer ending in 9. Tie at .5 rounds UP
 * (JS Math.round behavior for positives). Clamps to a $9 minimum so prices
 * below ~$5 don't roll over to negative candidates. */
function roundToNearest9(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return p;
  const m = Math.round((p - 9) / 10);
  const result = 10 * m + 9;
  return Math.max(9, result);
}

interface ShopifyVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
}
interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  variants: { nodes: ShopifyVariant[] };
}

async function mintToken(shop: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const j = await res.json() as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(`mintToken failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function gql<T>(endpoint: string, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json() as { data?: T; errors?: unknown };
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  if (!j.data) throw new Error("no data");
  return j.data;
}

async function fetchAllProducts(endpoint: string, token: string): Promise<ShopifyProduct[]> {
  const query = `
    query ($cursor: String) {
      products(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title handle
          variants(first: 100) {
            nodes { id title price compareAtPrice }
          }
        }
      }
    }
  `;
  const all: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const data = await gql<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProduct[] } }>(
      endpoint, token, query, { cursor },
    );
    all.push(...data.products.nodes);
    process.stdout.write(`  page ${page}: +${data.products.nodes.length} (running total ${all.length})\n`);
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return all;
}

interface VariantUpdate { id: string; price: string; compareAtPrice: null }

async function bulkUpdate(
  endpoint: string,
  token: string,
  productId: string,
  variants: VariantUpdate[],
): Promise<{ userErrors: Array<{ field: string[]; message: string }> }> {
  const mutation = `
    mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;
  const data = await gql<{ productVariantsBulkUpdate: { userErrors: Array<{ field: string[]; message: string }> } }>(
    endpoint, token, mutation, { productId, variants },
  );
  return data.productVariantsBulkUpdate;
}

interface ProductPlan {
  product: ShopifyProduct;
  changes: Array<{ variantId: string; title: string; oldPrice: string; newPrice: string; oldCompareAt: string | null; clearCompareAt: boolean }>;
  needsUpdate: boolean;
}

function planProduct(product: ShopifyProduct): ProductPlan {
  const changes = product.variants.nodes.map((v) => {
    const oldP = parseFloat(v.price);
    const newP = roundToNearest9(oldP);
    const newPriceStr = `${newP}.00`;
    const oldPriceStr = oldP.toFixed(2);
    const oldCompareAt = v.compareAtPrice;
    const priceChanged = newPriceStr !== oldPriceStr;
    const clearCompareAt = oldCompareAt != null && oldCompareAt !== "";
    return {
      variantId: v.id,
      title: v.title,
      oldPrice: oldPriceStr,
      newPrice: newPriceStr,
      oldCompareAt,
      clearCompareAt,
      priceChanged,
    };
  });
  const needsUpdate = changes.some((c) => c.priceChanged || c.clearCompareAt);
  return { product, changes, needsUpdate };
}

async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function pull(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => pull()));
  return out;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({
    where: { label: "Vilvida" },
    select: { id: true, storeDomain: true, accessToken: true, clientId: true, clientSecret: true },
  });
  if (!conn) { console.error("no Vilvida connection found"); process.exit(1); }
  if (!conn.clientId || !conn.clientSecret) {
    console.error("Vilvida connection has no clientId/clientSecret — cannot mint fresh token");
    process.exit(1);
  }

  console.log(`Minting fresh Shopify token for ${conn.storeDomain}…`);
  const token = await mintToken(conn.storeDomain, conn.clientId, conn.clientSecret);
  await prisma.shopifyConnection.update({ where: { id: conn.id }, data: { accessToken: token } });
  console.log(`  token ok (${token.slice(0, 12)}…)\n`);

  const endpoint = `https://${conn.storeDomain}/admin/api/2024-10/graphql.json`;
  console.log(`Fetching all products from ${conn.storeDomain}…`);
  const products = await fetchAllProducts(endpoint, token);
  console.log(`\nFetched ${products.length} products, ${products.reduce((acc, p) => acc + p.variants.nodes.length, 0)} variants total.\n`);

  const plans = products.map(planProduct);
  const toUpdate = plans.filter((p) => p.needsUpdate);
  const priceChangedCount = plans.reduce((acc, p) => acc + p.changes.filter((c) => c.priceChanged).length, 0);
  const compareAtClearedCount = plans.reduce((acc, p) => acc + p.changes.filter((c) => c.clearCompareAt).length, 0);

  console.log(`Plan:`);
  console.log(`  ${toUpdate.length}/${products.length} products need updates`);
  console.log(`  ${priceChangedCount} variant prices will change`);
  console.log(`  ${compareAtClearedCount} variant compareAt prices will be cleared\n`);

  if (toUpdate.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log("--- DRY-RUN preview (first 5 products) ---");
    for (const p of toUpdate.slice(0, 5)) {
      console.log(`\n→ ${p.product.title} (${p.product.handle})`);
      for (const c of p.changes) {
        if (c.priceChanged || c.clearCompareAt) {
          const cmpFlag = c.clearCompareAt ? `  | compareAt $${c.oldCompareAt} → null` : "";
          console.log(`    ${c.title.padEnd(40).slice(0, 40)}  $${c.oldPrice} → $${c.newPrice}${cmpFlag}`);
        }
      }
    }
    console.log(`\n(dry-run only — ${toUpdate.length - 5} more products not shown)`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Applying updates with concurrency ${CONCURRENCY}…\n`);
  type Result = { handle: string; status: "OK" | "FAILED" | "SKIPPED"; changed: number; error?: string };
  const results = await runWithConcurrency(toUpdate, CONCURRENCY, async (plan): Promise<Result> => {
    const variants: VariantUpdate[] = plan.changes
      .filter((c) => c.priceChanged || c.clearCompareAt)
      .map((c) => ({ id: c.variantId, price: c.newPrice, compareAtPrice: null }));
    if (variants.length === 0) return { handle: plan.product.handle, status: "SKIPPED", changed: 0 };
    try {
      const r = await bulkUpdate(endpoint, token, plan.product.id, variants);
      if (r.userErrors.length > 0) {
        console.log(`  ✗ ${plan.product.handle}: userErrors ${JSON.stringify(r.userErrors)}`);
        return { handle: plan.product.handle, status: "FAILED", changed: 0, error: JSON.stringify(r.userErrors) };
      }
      const samplePrice = plan.changes.find((c) => c.priceChanged);
      const sampleStr = samplePrice ? `  e.g. ${samplePrice.oldPrice} → ${samplePrice.newPrice}` : "";
      console.log(`  ✓ ${plan.product.handle.padEnd(50).slice(0, 50)} ${variants.length} variant(s)${sampleStr}`);
      return { handle: plan.product.handle, status: "OK", changed: variants.length };
    } catch (e) {
      console.log(`  ✗ ${plan.product.handle}: ${e instanceof Error ? e.message : e}`);
      return { handle: plan.product.handle, status: "FAILED", changed: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const ok = results.filter((r) => r.status === "OK");
  const failed = results.filter((r) => r.status === "FAILED");
  const totalChanged = ok.reduce((a, r) => a + r.changed, 0);
  console.log(`\n========== SUMMARY ==========`);
  console.log(`  Products updated: ${ok.length} / ${toUpdate.length}`);
  console.log(`  Variants changed: ${totalChanged}`);
  console.log(`  Products failed:  ${failed.length}`);
  if (failed.length > 0) {
    console.log(`\n  Failures:`);
    for (const f of failed) console.log(`    ${f.handle}: ${f.error}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
