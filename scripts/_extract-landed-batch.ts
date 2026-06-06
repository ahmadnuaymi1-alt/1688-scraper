/**
 * LIGHTWEIGHT 1688 landed-cost extractor.
 *
 * Reads scripts/_vilvida-pricing-input.json. For each row with a 1688 URL,
 * fetches the page via the existing Bright Data client, parses ONLY the
 * inline JSON state to extract { price, productWeightG }, computes landed
 * cost (CNY→USD + weight-bracket shipping), and writes the result to
 * scripts/_vilvida-landed-costs.json.
 *
 * No DB writes. No image downloads. No audit. No rules. No imports-UI entries.
 * Just a fetch + JSON parse + math.
 */
import fs from "node:fs";
import path from "node:path";
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

const CNY_TO_USD = 7.1;

function shippingUsdFromWeightG(weightG: number): number {
  if (weightG <= 500) return 8;
  if (weightG <= 1000) return 14;
  if (weightG <= 2000) return 26;
  if (weightG <= 3000) return 40;
  if (weightG <= 5000) return 60;
  if (weightG <= 10000) return 100;
  if (weightG <= 20000) return 180;
  return 250 + Math.round(((weightG - 20000) / 1000) * 5);
}

interface InputRow {
  shopifyId: string;
  title: string;
  handle: string;
  currentPrice: number | null;
  url1688: string | null;
  localProductId: string | null;
  mode: "full" | "comp-only";
}

interface LandedRow {
  shopifyId: string;
  url1688: string | null;
  ok: boolean;
  error?: string;
  supplierCNY?: number;
  supplierCurrency?: string;
  supplierUSD?: number;
  weightG?: number;
  shippingUSD?: number;
  landedUSD?: number;
}

async function extractOne(url: string): Promise<{ price: { min: number; max: number; currency: string }; productWeightG?: number } | { error: string }> {
  const { fetchViaBrightData } = await import("../src/lib/scraper/bright-data-client");
  const { parsePageState } = await import("../src/lib/scraper/page-state-parser");
  const m = url.match(/\/offer\/(\d+)\.html/);
  if (!m) return { error: `bad URL ${url}` };
  const offerId = m[1];
  try {
    const html = await fetchViaBrightData({ url });
    const product = parsePageState(html, offerId);
    if (!product) return { error: `parsePageState returned null for ${offerId}` };
    return { price: product.price, productWeightG: product.productWeightG };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const inputPath = path.resolve(process.cwd(), "scripts/_vilvida-pricing-input.json");
  const rows = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as InputRow[];

  // Only need rows where url1688 is set AND no localProductId (we already have
  // rawPayload for the ones with localProductId).
  // Actually — we want landed for ALL of them. The 22 with localProductId can
  // be read from local DB; the others must be extracted live. Let's do both:
  // for localProductId rows we read DB, for the rest we fetch.

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const out: LandedRow[] = [];

  // First: the rows with localProductId — read from DB.
  const localIds = rows.filter((r) => r.localProductId).map((r) => r.localProductId!);
  const localProducts = await prisma.product.findMany({
    where: { id: { in: localIds } },
    select: { id: true, rawPayload: true },
  });
  const localMap = new Map(localProducts.map((p) => [p.id, p.rawPayload]));

  for (const row of rows) {
    if (row.localProductId) {
      const raw = localMap.get(row.localProductId);
      if (!raw) {
        out.push({ shopifyId: row.shopifyId, url1688: row.url1688, ok: false, error: "rawPayload not in DB" });
        continue;
      }
      const parsed = JSON.parse(raw) as { price: { min: number; max: number; currency: string }; productWeightG?: number };
      const supplierCNY = parsed.price.min;
      const weightG = parsed.productWeightG ?? 2000; // fallback 2 kg
      const supplierUSD = supplierCNY / CNY_TO_USD;
      const shippingUSD = shippingUsdFromWeightG(weightG);
      const landedUSD = supplierUSD + shippingUSD;
      out.push({
        shopifyId: row.shopifyId,
        url1688: row.url1688,
        ok: true,
        supplierCNY,
        supplierCurrency: parsed.price.currency,
        supplierUSD: Math.round(supplierUSD * 100) / 100,
        weightG,
        shippingUSD,
        landedUSD: Math.round(landedUSD * 100) / 100,
      });
    }
  }
  console.log(`Read landed cost for ${out.filter((o) => o.ok).length} products from local DB.`);

  // Now the ones without localProductId BUT with url1688 — fetch live.
  const toFetch = rows.filter((r) => !r.localProductId && r.url1688);
  console.log(`Need to fetch ${toFetch.length} URLs via Bright Data…`);

  // Parallel with concurrency cap.
  const CONCURRENCY = 6;
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= toFetch.length) return;
      const row = toFetch[i];
      console.log(`  [${i + 1}/${toFetch.length}] ${row.url1688}`);
      const result = await extractOne(row.url1688!);
      if ("error" in result) {
        out.push({ shopifyId: row.shopifyId, url1688: row.url1688, ok: false, error: result.error });
        console.log(`    FAIL ${result.error}`);
      } else {
        const supplierCNY = result.price.min;
        const weightG = result.productWeightG ?? 2000;
        const supplierUSD = supplierCNY / CNY_TO_USD;
        const shippingUSD = shippingUsdFromWeightG(weightG);
        const landedUSD = supplierUSD + shippingUSD;
        out.push({
          shopifyId: row.shopifyId,
          url1688: row.url1688,
          ok: true,
          supplierCNY,
          supplierCurrency: result.price.currency,
          supplierUSD: Math.round(supplierUSD * 100) / 100,
          weightG,
          shippingUSD,
          landedUSD: Math.round(landedUSD * 100) / 100,
        });
        console.log(`    OK ¥${supplierCNY} (${weightG}g) → landed $${Math.round(landedUSD * 100) / 100}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Write output.
  const outPath = path.resolve(process.cwd(), "scripts/_vilvida-landed-costs.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  const ok = out.filter((o) => o.ok).length;
  const fail = out.filter((o) => !o.ok).length;
  const totalLanded = out.filter((o) => o.ok).reduce((s, o) => s + (o.landedUSD ?? 0), 0);
  console.log(`\nDONE — ${ok} ok, ${fail} failed, total landed across catalog: $${Math.round(totalLanded)}`);
  console.log(`Wrote ${outPath}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
