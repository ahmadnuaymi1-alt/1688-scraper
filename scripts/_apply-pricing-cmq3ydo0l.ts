/**
 * Step 8.5: AI-suggested pricing for cmq3ydo0l000jw288ns3doet5.
 * Two-call sequence per the agent-mode skill:
 *   1. recalculatePricing(productId, DEFAULT_SCRAPE_OPTIONS) → Claude generates pricing ladder + recommended tier
 *   2. Read Product.pricingNotes JSON to get recommendedTier
 *   3. applyPricingToVariants(productId, recommendedTier, DEFAULT_SCRAPE_OPTIONS)
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

const PID = "cmq3ydo0l000jw288ns3doet5";

async function main() {
  const { recalculatePricing, applyPricingToVariants } = await import(
    "../src/services/pricing.service"
  );
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  console.log(`\n=== Step 8.5a: recalculatePricing(${PID}) ===`);
  const t0 = Date.now();
  await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);
  console.log(`recalculatePricing done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Read Product.pricingNotes
  const p = await prisma.product.findUnique({
    where: { id: PID },
    select: { pricingNotes: true },
  });
  let notes: any = null;
  try {
    notes = p?.pricingNotes ? JSON.parse(String(p.pricingNotes)) : null;
  } catch (e) {
    console.error("Failed to parse pricingNotes JSON:", e);
  }

  const recommendedTier: string | undefined =
    notes?.recommendedTier ??
    notes?.recommended_tier ??
    notes?.recommended?.tier ??
    notes?.tier;

  console.log("\nrecommendedTier:", recommendedTier);
  console.log("pricingNotes summary:", JSON.stringify(notes, null, 2).slice(0, 2000));

  if (!recommendedTier) {
    console.error("\nNo recommendedTier found in pricingNotes — cannot apply tier.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n=== Step 8.5b: applyPricingToVariants(${PID}, "${recommendedTier}") ===`);
  const t1 = Date.now();
  await applyPricingToVariants(PID, recommendedTier, DEFAULT_SCRAPE_OPTIONS);
  console.log(`applyPricingToVariants done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Show final prices
  const after = await prisma.product.findUnique({
    where: { id: PID },
    select: {
      variants: {
        where: { isHidden: false },
        orderBy: { position: "asc" },
        select: { position: true, option1: true, price: true, compareAtPrice: true },
      },
    },
  });
  console.log("\nFinal variant prices (visible only):");
  for (const v of after?.variants ?? []) {
    console.log(`  [${v.position}] ${v.option1}: $${v.price} (compareAt=${v.compareAtPrice ?? "null"})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
