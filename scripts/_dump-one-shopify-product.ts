/**
 * Dump every field on ONE Shopify product to find where the 1688 URL might
 * be stored (tags, vendor, productType, metafields with private namespace,
 * etc.).
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

async function main() {
  const handle = process.argv[2] ?? "noah-modern-floor-lamp-with-adjustable-brightness-for-cozy-living-room-ambiance";
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({ where: { label: "Vilvida" }, select: { storeDomain: true, accessToken: true } });
  if (!conn) { console.log("no conn"); process.exit(1); }

  const query = `
    query Product($handle: String!) {
      productByHandle(handle: $handle) {
        id title handle status vendor productType tags
        descriptionHtml description
        metafields(first: 60) { nodes { namespace key value type } }
        variants(first: 1) { nodes { id title price compareAtPrice sku barcode inventoryItem { id } } }
      }
    }
  `;
  const res = await fetch(`https://${conn.storeDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": conn.accessToken, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { handle } }),
  });
  const json = await res.json();
  const p = json.data?.productByHandle;
  if (!p) { console.log("not found", JSON.stringify(json, null, 2)); process.exit(1); }
  console.log("title:", p.title);
  console.log("vendor:", p.vendor);
  console.log("productType:", p.productType);
  console.log("tags:", JSON.stringify(p.tags, null, 2));
  console.log("\nmetafields (all):");
  for (const m of (p.metafields?.nodes ?? [])) {
    console.log(`  ${m.namespace}.${m.key} (${m.type})`);
    console.log(`     value: ${(m.value ?? "").slice(0, 200)}`);
  }
  console.log("\nprivateMetafields:", JSON.stringify(p.privateMetafields, null, 2));
  console.log("\ndescription HTML (first 600 chars):");
  console.log((p.descriptionHtml ?? "").slice(0, 600));
  console.log("\nplain description (first 600 chars):");
  console.log((p.description ?? "").slice(0, 600));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
