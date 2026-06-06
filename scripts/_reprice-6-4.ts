/**
 * Re-price all products scraped on a given day (default 2026-06-04):
 *   final variant price = max(AI-suggested launch price, $79).
 * AI launch is applied via the standard applyPricingToVariants (rounds $4/$9,
 * no compare-at, 2x-landed floor); then every variant is floored to $79.
 *
 *   npx tsx scripts/_reprice-6-4.ts            # DRY-RUN: list the set + current prices
 *   npx tsx scripts/_reprice-6-4.ts --apply    # compute AI pricing + apply + $79 floor (sequential)
 *
 * Env: DAY=YYYY-MM-DD (UTC day), FLOOR=79
 */
import fs from "node:fs";
import path from "node:path";
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, ""); if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const DAY = process.env.DAY || "2026-06-04";
const FLOOR = parseFloat(process.env.FLOOR || "79");

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../src/lib/db");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { resetUsage, formatUsageSummary } = await import("../src/lib/ai/usage-tracker");
  resetUsage();

  const start = new Date(`${DAY}T00:00:00.000Z`);
  const end = new Date(`${DAY}T23:59:59.999Z`);
  const jobs = await prisma.scrapeJob.findMany({
    where: { createdAt: { gte: start, lte: end }, product: { isNot: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, createdAt: true, options: true,
      product: { select: { id: true, title: true, pricingNotes: true, variants: { where: { isHidden: false }, select: { price: true } } } },
    },
  });

  console.log(`${jobs.length} product(s) scraped on ${DAY} (UTC).  Floor = $${FLOOR}\n`);
  if (jobs.length === 0) { await prisma.$disconnect(); return; }

  const priceRange = (prices: string[]) => {
    const nums = prices.map((p) => parseFloat(p)).filter((n) => Number.isFinite(n));
    return nums.length ? `$${Math.min(...nums).toFixed(0)}–$${Math.max(...nums).toFixed(0)}` : "—";
  };

  if (!apply) {
    for (const j of jobs) {
      const p = j.product!;
      console.log(`  ${p.id}  cur ${priceRange(p.variants.map((v) => v.price)).padEnd(12)} ${p.pricingNotes ? "[has AI price]" : "[no AI price]"}  ${(p.title ?? "").slice(0, 50)}`);
    }
    console.log(`\nDRY-RUN — re-run with --apply to compute AI pricing + apply the $${FLOOR} floor.`);
    await prisma.$disconnect();
    return;
  }

  // Suppress unused-import lint in this simplified path (kept for reference).
  void recalculatePricing; void applyPricingToVariants; void DEFAULT_SCRAPE_OPTIONS;

  let canSellMore = 0, flooredProducts = 0, recomputed = 0;
  for (let n = 0; n < jobs.length; n++) {
    const j = jobs[n]; const p = j.product!;
    const tag = `[${n + 1}/${jobs.length}] ${(p.title ?? "").slice(0, 40)}`;
    try {
      // The AI launch price is ALREADY applied to these variants (priced at
      // scrape). If a product somehow has no AI price, compute it now.
      let rationale = p.pricingNotes ? (() => { try { return JSON.parse(p.pricingNotes!); } catch { return null; } })() : null;
      if (!rationale || !Array.isArray(rationale.ladder)) {
        const options = (() => { try { return { ...DEFAULT_SCRAPE_OPTIONS, ...JSON.parse(j.options ?? "{}") }; } catch { return DEFAULT_SCRAPE_OPTIONS; } })();
        rationale = await recalculatePricing(p.id, options);
        await applyPricingToVariants(p.id, "launch", options);
        recomputed++;
      }
      const launch = rationale.ladder?.find((t: { label: string; price: number }) => t.label === "launch")?.price ?? null;
      const stretch = rationale.ladder?.find((t: { label: string; price: number }) => t.label === "stretch")?.price ?? null;

      const vs = await prisma.variant.findMany({ where: { productId: p.id, isHidden: false }, select: { id: true, price: true } });
      const curMin = Math.min(...vs.map((v) => parseFloat(v.price)));
      // $79 floor: bump every variant below FLOOR up to FLOOR (already a clean breakpoint).
      let bumped = 0;
      for (const v of vs) {
        if (parseFloat(v.price) < FLOOR) {
          await prisma.variant.update({ where: { id: v.id }, data: { price: FLOOR.toFixed(2), compareAtPrice: null } });
          bumped++;
        }
      }
      const after = await prisma.variant.findMany({ where: { productId: p.id, isHidden: false }, select: { price: true } });
      const aboveFloor = curMin >= FLOOR;
      if (aboveFloor) canSellMore++;
      if (bumped > 0) flooredProducts++;
      console.log(
        `${tag}  AI $${launch ?? "?"}${stretch ? ` (stretch $${stretch})` : ""} → ${priceRange(after.map((v) => v.price))}  ` +
          (aboveFloor ? "✓ AI already ≥ floor" : `floored ${bumped}/${vs.length} → $${FLOOR}`),
      );
    } catch (err) {
      console.error(`${tag}  FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nAI priced ${canSellMore}/${jobs.length} at or above $${FLOOR}; ${flooredProducts} product(s) had variants floored to $${FLOOR}.${recomputed ? ` (${recomputed} AI-recomputed)` : ""}`);
  console.log(formatUsageSummary());
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
