/**
 * AI-suggested pricing for cmq3yck9q000jw2q03468fge7.
 * Two-call sequence: recalculatePricing then applyPricingToVariants(recommendedTier).
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

const PID = "cmq3yck9q000jw2q03468fge7";

async function main() {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  console.log("Calling recalculatePricing()...");
  await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);

  const product = await prisma.product.findUnique({
    where: { id: PID },
    select: { pricingNotes: true },
  });

  let notes: any = product?.pricingNotes ?? null;
  if (typeof notes === "string") {
    try { notes = JSON.parse(notes); } catch (e) { console.log("pricingNotes is string but not JSON-parseable"); }
  }
  console.log("\npricingNotes top-level keys:", notes ? Object.keys(notes) : "(none)");
  if (notes?.recommendedTier) {
    console.log("recommendedTier:", notes.recommendedTier);
  }
  if (notes?.tiers) {
    console.log("tiers found:", Object.keys(notes.tiers));
  }
  if (notes?.rationale) {
    console.log("rationale (first 300):", String(notes.rationale).slice(0, 300));
  }

  // Pretty-print the whole thing for visibility
  console.log("\nFull pricingNotes:");
  console.log(JSON.stringify(notes, null, 2).slice(0, 3000));

  const recommendedTier =
    notes?.recommendedTier ??
    notes?.recommended_tier ??
    notes?.recommended?.label ??
    null;

  if (!recommendedTier) {
    console.log("\nNo recommendedTier in pricingNotes — cannot auto-apply.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying tier "${recommendedTier}"...`);
  await applyPricingToVariants(PID, recommendedTier, DEFAULT_SCRAPE_OPTIONS);

  const variants = await prisma.variant.findMany({
    where: { productId: PID },
    select: { position: true, option1: true, price: true, compareAtPrice: true, supplierCost: true },
    orderBy: { position: "asc" },
  });
  console.log("\nVariants after pricing:");
  for (const v of variants) {
    console.log(`  #${v.position} ${v.option1}  price=$${v.price}  compareAt=${v.compareAtPrice ?? "null"}  cost=$${v.supplierCost}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
