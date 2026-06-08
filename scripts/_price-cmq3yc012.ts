/**
 * AI-suggested pricing for cmq3yc012 (agent-mode batch).
 * 1. recalculatePricing → generates ladder + recommended tier
 * 2. applyPricingToVariants → applies recommended tier
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

const PRODUCT_ID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  console.log("Step 1: recalculatePricing...");
  const t0 = Date.now();
  await recalculatePricing(PRODUCT_ID, DEFAULT_SCRAPE_OPTIONS);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { pricingNotes: true },
  });
  let recommendedTier: string | null = null;
  if (p?.pricingNotes) {
    try {
      const notes = typeof p.pricingNotes === "string" ? JSON.parse(p.pricingNotes) : p.pricingNotes;
      recommendedTier = notes?.recommended?.label ?? notes?.recommendedTier ?? notes?.recommended_tier ?? notes?.tier ?? null;
      console.log("  recommendedTier:", recommendedTier);
      if (!recommendedTier) {
        console.log("  pricingNotes keys:", Object.keys(notes ?? {}));
        console.log("  pricingNotes preview:", JSON.stringify(notes).slice(0, 500));
      }
    } catch (e) {
      console.error("  failed to parse pricingNotes:", e);
    }
  }

  if (!recommendedTier) {
    console.error("No recommendedTier found — aborting apply.");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Step 2: applyPricingToVariants(tier=${recommendedTier})...`);
  const t1 = Date.now();
  await applyPricingToVariants(PRODUCT_ID, recommendedTier, DEFAULT_SCRAPE_OPTIONS);
  console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const variants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID, isHidden: false },
    select: { position: true, option1: true, price: true, compareAtPrice: true },
    orderBy: { position: "asc" },
  });
  console.log("\nFinal prices:");
  for (const v of variants) {
    console.log(`  #${v.position} ${v.option1?.slice(0, 40)} → $${v.price} (compareAt=${v.compareAtPrice ?? "null"})`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
