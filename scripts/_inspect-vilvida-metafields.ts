/**
 * Read-only diagnostic. Fetch the Vilvida connection, query Shopify for:
 *   1. The latest ~30 products in the store (to find ones with metafields)
 *   2. The metafield definitions in the store
 *   3. A sample of metafield values from a few products
 *
 * Prints the namespace + key + type + truncated value so we can reverse-
 * engineer the "Image with text" / "FAQ" metafield schema.
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

async function shopifyGraphQL<T>(
  storeDomain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `https://${storeDomain}/admin/api/2024-10/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

(async () => {
  const conn = await prisma.shopifyConnection.findFirst({ where: { label: "Vilvida" } });
  if (!conn) {
    console.error("No Vilvida connection");
    process.exit(1);
  }

  // 1. List the most recent 30 products WITH ALL their metafields (paged).
  console.log("=== Recent Vilvida products + metafields ===\n");
  const PRODUCTS_QUERY = `
    query RecentProducts($n: Int!) {
      products(first: $n, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            title
            handle
            createdAt
            metafields(first: 30) {
              edges {
                node {
                  namespace
                  key
                  type
                  value
                }
              }
            }
          }
        }
      }
    }
  `;
  const productsRes = await shopifyGraphQL<{
    data: { products: { edges: Array<{ node: {
      id: string; title: string; handle: string; createdAt: string;
      metafields: { edges: Array<{ node: { namespace: string; key: string; type: string; value: string } }> };
    } }> } };
  }>(conn.storeDomain, conn.accessToken, PRODUCTS_QUERY, { n: 30 });

  const products = productsRes.data.products.edges.map((e) => e.node);
  for (const p of products) {
    const mfs = p.metafields.edges.map((e) => e.node);
    if (mfs.length === 0) continue;
    console.log(`\n${p.handle}  (${p.id})  ${p.createdAt}`);
    console.log(`  title: ${p.title.slice(0, 80)}`);
    for (const m of mfs) {
      const vTrunc = m.value.length > 200 ? `${m.value.slice(0, 200)}...` : m.value;
      console.log(`  ${m.namespace}.${m.key}  (${m.type})`);
      console.log(`     value: ${vTrunc}`);
    }
  }

  // 2. Metafield definitions.
  console.log(`\n\n=== Metafield Definitions (ownerType=PRODUCT) ===\n`);
  const DEFS_QUERY = `
    query Defs {
      metafieldDefinitions(first: 50, ownerType: PRODUCT) {
        edges {
          node {
            id
            namespace
            key
            name
            description
            type { name }
          }
        }
      }
    }
  `;
  const defsRes = await shopifyGraphQL<{
    data: { metafieldDefinitions: { edges: Array<{ node: {
      id: string; namespace: string; key: string; name: string; description: string | null;
      type: { name: string };
    } }> } };
  }>(conn.storeDomain, conn.accessToken, DEFS_QUERY);
  for (const e of defsRes.data.metafieldDefinitions.edges) {
    const d = e.node;
    console.log(`  ${d.namespace}.${d.key}  (${d.type.name})  "${d.name}"`);
    if (d.description) console.log(`     desc: ${d.description.slice(0, 120)}`);
  }

  await prisma.$disconnect();
})();
