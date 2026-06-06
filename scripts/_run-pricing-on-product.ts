/**
 * Run the existing AI pricing pipeline on one product and report what it produced.
 * Uses the current code (no new landed-cost work) so you can see today's baseline.
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

const PRODUCT_ID = process.argv[2] ?? "cmpspa7wm0075w24ccqg9mzbn";

async function main() {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  const prisma = new PrismaClient();

  // Snapshot the variants BEFORE pricing for comparison.
  const before = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      title: true,
      productType: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          position: true, title: true, price: true, compareAtPrice: true,
          supplierCost: true, weight: true, weightUnit: true,
        },
      },
    },
  });
  if (!before) { console.log(`NOT FOUND: ${PRODUCT_ID}`); process.exit(1); }

  console.log(`\n========================================================`);
  console.log(`Product: ${before.title}`);
  console.log(`Type:    ${before.productType ?? "(none)"}`);
  console.log(`Variants visible to pricing: ${before.variants.length}`);
  console.log(`========================================================\n`);
  console.log(`--- BEFORE ---`);
  for (const v of before.variants.slice(0, 5)) {
    console.log(`  pos${v.position} ${v.title?.slice(0,40).padEnd(40)} ` +
      `price=$${v.price} compareAt=${v.compareAtPrice ? "$"+v.compareAtPrice : "(none)"} ` +
      `supplierCost=${v.supplierCost ? "$"+v.supplierCost : "(none)"} ` +
      `weight=${v.weight ?? "(none)"} ${v.weightUnit ?? ""}`);
  }
  if (before.variants.length > 5) console.log(`  … and ${before.variants.length - 5} more`);

  // Resolve a sane source cost. Take the first non-null supplierCost OR price.
  let costPerItem: string | undefined;
  for (const v of before.variants) {
    if (v.supplierCost && parseFloat(v.supplierCost) > 0) { costPerItem = v.supplierCost; break; }
    if (v.price && parseFloat(v.price) > 0 && !costPerItem) { costPerItem = v.price; }
  }

  const options = {
    ...DEFAULT_SCRAPE_OPTIONS,
    suggestedPricing: true,
    costPerItem,
  };
  console.log(`\nResolved costPerItem for prompt: $${costPerItem ?? "(none — Claude will see $0 cost)"}`);

  console.log(`\n--- Calling recalculatePricing()… (web_search + Claude Haiku) ---`);
  const t0 = Date.now();
  let rationale;
  try {
    rationale = await recalculatePricing(PRODUCT_ID, options);
  } catch (e) {
    console.error(`recalculatePricing FAILED: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done in ${wall}s.`);

  console.log(`\n--- LADDER ---`);
  for (const t of rationale.ladder) {
    console.log(`  ${t.label.padEnd(10)} $${t.price}   ${t.reasoning?.slice(0, 120) ?? ""}`);
  }
  if (rationale.perVariantPricing) {
    console.log(`\n--- PER-VARIANT MODE: ${rationale.perVariantPricing.mode} ---`);
    console.log(`  ${rationale.perVariantPricing.rationale?.slice(0, 240) ?? ""}`);
    for (const t of rationale.perVariantPricing.tiers) {
      console.log(`  ${t.label.padEnd(20)} positions=[${t.variantPositions?.join(",")}] mul=${t.multiplier}`);
    }
  }
  console.log(`\n--- COMPS (${rationale.comps?.length ?? 0}) ---`);
  for (const c of (rationale.comps ?? []).slice(0, 8)) {
    console.log(`  ${(c.tier ?? "?").padEnd(10)} ${c.brand?.slice(0,20).padEnd(20) ?? ""} ${c.title?.slice(0,40).padEnd(40) ?? ""} $${c.price}`);
  }
  console.log(`\n--- SATURATION: ${rationale.marketSaturated ? "HIGH" : "OK"} ---`);
  console.log(`\n--- NOTES ---`);
  console.log(`  ${rationale.notes ?? "(none)"}`);

  console.log(`\n--- Applying launch tier to variants… ---`);
  await applyPricingToVariants(PRODUCT_ID, "launch", options);

  const after = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      variants: {
        orderBy: { position: "asc" },
        select: { position: true, title: true, price: true, compareAtPrice: true },
      },
    },
  });
  console.log(`\n--- AFTER ---`);
  for (const v of after!.variants.slice(0, 5)) {
    console.log(`  pos${v.position} ${v.title?.slice(0,40).padEnd(40)} ` +
      `price=$${v.price} compareAt=${v.compareAtPrice ? "$"+v.compareAtPrice : "(none)"}`);
  }
  if (after!.variants.length > 5) console.log(`  … and ${after!.variants.length - 5} more`);
  console.log(`\nReview: http://localhost:3000/review/${PRODUCT_ID}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
