/**
 * Bulk update Vilvida product prices via Shopify Admin API.
 *
 * For each (shopifyHandle, newPrice) tuple:
 *   1. Fetch the product + all its variants from Shopify
 *   2. Find the minimum current variant price (the "anchor")
 *   3. Compute scaling factor = newPrice / currentMin
 *   4. Apply the factor to ALL variants — preserves existing spread, so the
 *      tall variant stays proportionally higher than the short variant.
 *   5. Print preview of every variant update before applying
 *   6. Call productVariantsBulkUpdate to commit
 *
 * Safety: prints all changes before each mutation. Dry-run mode available via
 * `--dry-run` for sanity check.
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

// (handle, recommendedPrice)
const UPDATES: Array<{ handle: string; newPrice: number; name: string }> = [
  { handle: "led-o0aba8rp", newPrice: 109, name: "Walnut Wood Aluminum Flush Mount (retry)" },
  { handle: "offer-1008724830559", newPrice: 69, name: "Tea Brown Ribbed RGB Table Lamp" },
  { handle: "elongated-black-outdoor-water-resistant-wall-sconce", newPrice: 89, name: "Elongated Black Outdoor Sconce" },
  { handle: "offer-884173459922", newPrice: 69, name: "Woven Bamboo Spherical Pendant" },
  { handle: "abs-white-5-blade-dimmable-led-ceiling-fan-light", newPrice: 129, name: "ABS White 5-Blade Fan" },
  { handle: "led-qmtk0bc0", newPrice: 89, name: "Iron Rectangular Stepless Dimming Ceiling" },
  { handle: "offer-651736472000", newPrice: 109, name: "Aluminum Sand White Linear Ceiling" },
  { handle: "fabric-wireless-rgb-remote-control-1-light-wall-sconce", newPrice: 79, name: "Fabric Wireless RGB Sconce" },
  { handle: "aluminum-black-bar-adjustable-led-wall-sconce", newPrice: 59, name: "Aluminum Black Bar Sconce" },
];

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

async function fetchProduct(endpoint: string, token: string, handle: string): Promise<ShopifyProduct | null> {
  const query = `
    query ($handle: String!) {
      productByHandle(handle: $handle) {
        id title handle
        variants(first: 100) {
          nodes { id title price compareAtPrice }
        }
      }
    }
  `;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { handle } }),
  });
  const json = await res.json() as { data?: { productByHandle: ShopifyProduct | null }; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data?.productByHandle ?? null;
}

async function bulkUpdateVariants(
  endpoint: string,
  token: string,
  productId: string,
  variants: Array<{ id: string; price: string }>,
): Promise<void> {
  const mutation = `
    mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: mutation, variables: { productId, variants } }),
  });
  const json = await res.json() as { data?: { productVariantsBulkUpdate: { userErrors: Array<{ field: string[]; message: string }> } }; errors?: unknown };
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  const errs = json.data?.productVariantsBulkUpdate.userErrors ?? [];
  if (errs.length > 0) throw new Error(`userErrors: ${JSON.stringify(errs)}`);
}

async function main() {
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({ where: { label: "Vilvida" }, select: { storeDomain: true, accessToken: true } });
  if (!conn) { console.log("no Vilvida connection"); process.exit(1); }
  const endpoint = `https://${conn.storeDomain}/admin/api/2024-10/graphql.json`;

  console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Updating ${UPDATES.length} products on ${conn.storeDomain}\n`);

  const summary: Array<{ name: string; status: string; variantCount: number; firstOld: string; firstNew: string }> = [];
  for (const u of UPDATES) {
    const product = await fetchProduct(endpoint, conn.accessToken, u.handle);
    if (!product) {
      console.log(`✗ ${u.name}: handle "${u.handle}" not found in Shopify`);
      summary.push({ name: u.name, status: "NOT FOUND", variantCount: 0, firstOld: "-", firstNew: "-" });
      continue;
    }
    const variants = product.variants.nodes;
    const currentMin = Math.min(...variants.map((v) => parseFloat(v.price)));
    if (!Number.isFinite(currentMin) || currentMin <= 0) {
      console.log(`✗ ${u.name}: invalid current min price ${currentMin}`);
      summary.push({ name: u.name, status: "INVALID PRICE", variantCount: variants.length, firstOld: "-", firstNew: "-" });
      continue;
    }
    const factor = u.newPrice / currentMin;
    const updates = variants.map((v) => {
      const oldP = parseFloat(v.price);
      const newP = oldP === currentMin ? u.newPrice : Math.round(oldP * factor * 100) / 100;
      return { id: v.id, oldPrice: v.price, newPrice: newP.toFixed(2), title: v.title };
    });

    console.log(`\n→ ${u.name} (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
    console.log(`   anchor: minPrice ${currentMin.toFixed(2)} → ${u.newPrice}  factor ${factor.toFixed(3)}`);
    for (const upd of updates) {
      console.log(`     ${upd.title.padEnd(40).slice(0, 40)}  $${upd.oldPrice}  →  $${upd.newPrice}`);
    }

    if (!DRY_RUN) {
      try {
        await bulkUpdateVariants(endpoint, conn.accessToken, product.id, updates.map((u) => ({ id: u.id, price: u.newPrice })));
        console.log(`   ✓ updated`);
        summary.push({ name: u.name, status: "OK", variantCount: variants.length, firstOld: `$${updates[0].oldPrice}`, firstNew: `$${updates[0].newPrice}` });
      } catch (e) {
        console.log(`   ✗ FAILED: ${e instanceof Error ? e.message : e}`);
        summary.push({ name: u.name, status: "FAILED", variantCount: variants.length, firstOld: `$${updates[0].oldPrice}`, firstNew: `$${updates[0].newPrice}` });
      }
    } else {
      summary.push({ name: u.name, status: "DRY-RUN", variantCount: variants.length, firstOld: `$${updates[0].oldPrice}`, firstNew: `$${updates[0].newPrice}` });
    }
  }

  console.log(`\n========== SUMMARY ==========`);
  for (const s of summary) {
    console.log(`  ${s.status.padEnd(10)} ${s.name.padEnd(45)} ${s.variantCount} variant(s)  first: ${s.firstOld} → ${s.firstNew}`);
  }
  const okCount = summary.filter((s) => s.status === "OK").length;
  const failCount = summary.filter((s) => s.status === "FAILED" || s.status === "NOT FOUND" || s.status === "INVALID PRICE").length;
  console.log(`\nTotal: ${okCount} OK, ${failCount} failed${DRY_RUN ? " (dry-run, no changes applied)" : ""}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
