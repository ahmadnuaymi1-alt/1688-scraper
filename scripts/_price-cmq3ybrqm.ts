/** AI-suggested pricing for cmq3ybrqm000jw25g2h0dyzbp — Step 8.5 of agent-mode */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";

(async () => {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();
  try {
    console.log("Step 1: recalculate pricing (Claude AI → pricing ladder + recommended tier)");
    const t0 = Date.now();
    await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);
    console.log(`  recalculatePricing done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Read recommended tier from Product.pricingNotes
    const product = await prisma.product.findUnique({ where: { id: PID }, select: { pricingNotes: true } });
    let notes: any = null;
    try { notes = product?.pricingNotes ? JSON.parse(product.pricingNotes) : null; } catch {}
    if (!notes) {
      console.log("  No pricingNotes JSON; pricingNotes raw:", product?.pricingNotes?.slice(0, 200));
      return;
    }
    const recommendedTier = notes.recommended?.label ?? notes.recommendedTier ?? notes.recommended_tier ?? notes.tier ?? null;
    console.log(`  Recommended tier: ${recommendedTier}`);
    if (notes.ladder) console.log(`  Ladder snapshot:`, Array.isArray(notes.ladder) ? notes.ladder.map((l:any) => `${l.tier ?? l.name ?? l}: $${l.price ?? l.anchorPrice ?? "?"}`).join(", ") : notes.ladder);
    if (notes.rationale) console.log(`  Rationale (truncated): ${String(notes.rationale).slice(0, 300)}`);

    if (!recommendedTier) {
      console.log("  No recommendedTier found in pricingNotes; SKIP applyPricingToVariants.");
      return;
    }

    console.log(`\nStep 2: apply tier "${recommendedTier}" to variants`);
    const t1 = Date.now();
    await applyPricingToVariants(PID, recommendedTier, DEFAULT_SCRAPE_OPTIONS);
    console.log(`  applyPricingToVariants done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    // Verify variant prices
    const variants = await prisma.variant.findMany({
      where: { productId: PID, isHidden: false },
      orderBy: { position: "asc" },
      select: { position: true, option1: true, price: true, compareAtPrice: true },
    });
    console.log(`\nFinal prices (${variants.length} visible variants):`);
    for (const v of variants) {
      console.log(`  #${String(v.position).padStart(2)} $${v.price} (compareAt=${v.compareAtPrice ?? "null"}) — ${v.option1}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
