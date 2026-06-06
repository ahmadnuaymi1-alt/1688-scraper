/**
 * Fetch all Vilvida products via Shopify Admin GraphQL API + extract the
 * 1688 source URL from each. Cross-checks against local DB to identify which
 * products need re-scraping. Outputs JSON for the next step.
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

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  priceRange?: { min: number; max: number };
  variants: Array<{ id: string; title: string; price: string; compareAtPrice: string | null }>;
  metafields: Array<{ namespace: string; key: string; value: string }>;
  descriptionHtml: string;
}

function extract1688Url(text: string): string | null {
  if (!text) return null;
  // Match canonical 1688 detail URL.
  const m = text.match(/https?:\/\/detail\.1688\.com\/offer\/(\d+)\.html/);
  if (m) return m[0];
  // Match bare offer-id pattern (in case URL was stripped).
  const offerMatch = text.match(/\boffer[-_/](\d{10,13})\b/);
  if (offerMatch) return `https://detail.1688.com/offer/${offerMatch[1]}.html`;
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const conn = await prisma.shopifyConnection.findFirst({
    where: { label: "Vilvida" },
    select: { storeDomain: true, accessToken: true },
  });
  if (!conn) { console.log("No Vilvida connection"); process.exit(1); }
  console.log(`Using store: ${conn.storeDomain}`);

  const apiVersion = "2024-10";
  const endpoint = `https://${conn.storeDomain}/admin/api/${apiVersion}/graphql.json`;

  // GraphQL query: pull all products with their variants + metafields + body + TAGS (this is where the 1688 URL lives).
  const query = `
    query Products($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title handle status vendor descriptionHtml tags
          metafields(first: 30) { nodes { namespace key value } }
          variants(first: 50) { nodes { id title price compareAtPrice } }
        }
      }
    }
  `;

  let cursor: string | null = null;
  const all: ShopifyProduct[] = [];
  for (let page = 1; page < 10; page++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": conn.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { cursor } }),
    });
    if (!res.ok) {
      console.error(`page ${page} HTTP ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    const json = await res.json() as { data?: { products?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<Record<string, unknown>> } }; errors?: unknown };
    if (json.errors) {
      console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
      process.exit(1);
    }
    const nodes = json.data?.products?.nodes ?? [];
    for (const node of nodes) {
      const variantNodes = ((node as { variants?: { nodes?: Array<{ id: string; title: string; price: string; compareAtPrice: string | null }> } }).variants?.nodes) ?? [];
      const metafieldNodes = ((node as { metafields?: { nodes?: Array<{ namespace: string; key: string; value: string }> } }).metafields?.nodes) ?? [];
      const tags = ((node as { tags?: string[] }).tags) ?? [];
      all.push({
        id: String(node.id),
        title: String(node.title),
        handle: String(node.handle),
        status: String(node.status),
        vendor: String((node as { vendor: string }).vendor ?? ""),
        descriptionHtml: String((node as { descriptionHtml?: string }).descriptionHtml ?? ""),
        variants: variantNodes.map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
        })),
        metafields: metafieldNodes,
        tags,
      } as ShopifyProduct & { tags: string[] });
    }
    const pageInfo = json.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }
  console.log(`\nFetched ${all.length} products from Shopify.\n`);

  // Cross-check against local DB.
  const localProducts = await prisma.product.findMany({
    select: { id: true, title: true, rawPayload: true, uploads: { select: { shopifyHandle: true, shopifyProductId: true } } },
  });
  const handleToLocal = new Map<string, { id: string; title: string; rawPayload: string }>();
  for (const p of localProducts) {
    for (const u of p.uploads) {
      if (u.shopifyHandle) handleToLocal.set(u.shopifyHandle, { id: p.id, title: p.title, rawPayload: p.rawPayload });
    }
  }

  // For each Shopify product, find the 1688 URL (TAGS is the canonical location, then metafields, then description, then handle).
  const analysis = all.map((p) => {
    let url1688: string | null = null;
    let urlSource: string = "(none)";
    // 1. TAGS — this is where the user actually stores it.
    const tags = (p as ShopifyProduct & { tags?: string[] }).tags ?? [];
    for (const t of tags) {
      const u = extract1688Url(t);
      if (u) { url1688 = u; urlSource = "tag"; break; }
    }
    // 2. Metafields.
    if (!url1688) {
      for (const mf of p.metafields) {
        const u = extract1688Url(mf.value);
        if (u) { url1688 = u; urlSource = `metafield ${mf.namespace}.${mf.key}`; break; }
      }
    }
    // 3. Description.
    if (!url1688) {
      const u = extract1688Url(p.descriptionHtml);
      if (u) { url1688 = u; urlSource = "descriptionHtml"; }
    }
    // 4. Handle (offer-NNN pattern).
    if (!url1688) {
      const u = extract1688Url(p.handle);
      if (u) { url1688 = u; urlSource = "handle"; }
    }
    const local = handleToLocal.get(p.handle);
    return {
      shopifyId: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      vendor: p.vendor,
      currentPrice: p.variants[0]?.price ?? null,
      currentCompareAt: p.variants[0]?.compareAtPrice ?? null,
      variantCount: p.variants.length,
      url1688,
      urlSource,
      localProductId: local?.id ?? null,
      hasRawPayload: Boolean(local?.rawPayload),
      metafieldKeys: p.metafields.map((m) => `${m.namespace}.${m.key}`),
    };
  });

  // Summarize.
  const withLocal = analysis.filter((a) => a.hasRawPayload);
  const withUrl = analysis.filter((a) => a.url1688);
  const needScrape = analysis.filter((a) => !a.hasRawPayload && a.url1688);
  const stuck = analysis.filter((a) => !a.hasRawPayload && !a.url1688);

  console.log(`SUMMARY:`);
  console.log(`  With local rawPayload (analyze directly):     ${withLocal.length}`);
  console.log(`  With 1688 URL available:                       ${withUrl.length}`);
  console.log(`  Need re-scrape from 1688 URL:                  ${needScrape.length}`);
  console.log(`  Stuck (no local + no 1688 URL):                ${stuck.length}`);

  // Write the report.
  const outPath = path.resolve(process.cwd(), "scripts/_vilvida-with-1688.json");
  fs.writeFileSync(outPath, JSON.stringify(analysis, null, 2), "utf-8");
  console.log(`\nWrote ${outPath}`);

  // Quick samples to verify.
  console.log(`\n--- sample need-scrape entries ---`);
  for (const a of needScrape.slice(0, 10)) {
    console.log(`  ${a.handle} (${a.urlSource}) → ${a.url1688}`);
    console.log(`     title: ${a.title.slice(0, 70)}`);
  }
  if (stuck.length > 0) {
    console.log(`\n--- stuck (no URL) ---`);
    for (const a of stuck) {
      console.log(`  ${a.handle}  metafieldKeys=[${a.metafieldKeys.join(", ")}]`);
      console.log(`     title: ${a.title.slice(0, 70)}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
