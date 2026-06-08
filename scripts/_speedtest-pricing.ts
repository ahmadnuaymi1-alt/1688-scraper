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

const PID = "cmq406kfj000jw2kcgbtfugv6";

async function main() {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  // recalculatePricing was flaky in the batch (conversational preamble); retry up to 4x.
  let ok = false;
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    try {
      console.log(`recalculatePricing attempt ${attempt}...`);
      await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);
      ok = true;
    } catch (e) {
      console.log(`  attempt ${attempt} failed: ${(e as Error).message?.slice(0, 160)}`);
    }
  }
  if (!ok) { console.log("recalculatePricing failed after 4 attempts"); await prisma.$disconnect(); return; }

  const product = await prisma.product.findUnique({ where: { id: PID }, select: { pricingNotes: true } });
  let notes: any = product?.pricingNotes ?? null;
  if (typeof notes === "string") { try { notes = JSON.parse(notes); } catch {} }
  const recommendedTier = notes?.recommendedTier ?? notes?.recommended_tier ?? notes?.recommended?.label ?? null;
  console.log("recommendedTier resolved:", recommendedTier);
  if (!recommendedTier) { console.log("No tier — cannot auto-apply."); await prisma.$disconnect(); return; }

  await applyPricingToVariants(PID, recommendedTier, DEFAULT_SCRAPE_OPTIONS);
  const variants = await prisma.variant.findMany({ where: { productId: PID }, select: { position: true, option1: true, price: true, compareAtPrice: true, supplierCost: true }, orderBy: { position: "asc" } });
  console.log("Variants after pricing:");
  for (const v of variants) console.log(`  #${v.position} ${v.option1} price=$${v.price} compareAt=${v.compareAtPrice ?? "null"} cost=$${v.supplierCost}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
