/**
 * Step 8.5 — Run AI-suggested pricing, then apply the recommended tier to all variants.
 * Sequential prisma (connection_limit=1 invariant).
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

const PID = "cmq3yf1eq000jw2kcemhuhsp9";

(async () => {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  const prisma = new PrismaClient();
  try {
    console.log("[8.5/1] Running recalculatePricing (Claude AI analysis)...");
    const t0 = Date.now();
    await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const product = await prisma.product.findUnique({
      where: { id: PID },
      select: { pricingNotes: true },
    });
    const notesRaw = product?.pricingNotes ?? null;
    console.log("\npricingNotes raw type:", typeof notesRaw);
    let parsed: any = null;
    if (typeof notesRaw === "string") {
      try { parsed = JSON.parse(notesRaw); } catch { parsed = null; }
    } else if (notesRaw && typeof notesRaw === "object") {
      parsed = notesRaw;
    }
    console.log("pricingNotes parsed (keys):", parsed ? Object.keys(parsed) : "(none)");

    // Look for the recommended tier in common known shapes
    const rec =
      parsed?.recommendedTier ??
      parsed?.recommended_tier ??
      parsed?.tier ??
      parsed?.recommended ??
      null;

    console.log("recommendedTier:", rec);

    if (!rec) {
      console.log("\nFull pricingNotes (truncated 1500 chars):");
      console.log(JSON.stringify(parsed ?? notesRaw, null, 2).slice(0, 1500));
      throw new Error("Could not find recommendedTier in pricingNotes");
    }

    const tierLabel: string = typeof rec === "string" ? rec : (rec?.label ?? rec?.name ?? rec?.tier);
    if (!tierLabel) throw new Error("recommended tier has no label");
    console.log(`\n[8.5/2] Applying tier label "${tierLabel}" to variants...`);
    const t1 = Date.now();
    await applyPricingToVariants(PID, tierLabel, DEFAULT_SCRAPE_OPTIONS);
    console.log(`  done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

    const after = await prisma.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { position: true, title: true, price: true, compareAtPrice: true },
    });
    console.log("\nFinal variant prices:");
    for (const v of after) {
      console.log(`  pos=${v.position}  price=${v.price}  compareAt=${v.compareAtPrice ?? "(null)"}  title=${v.title}`);
    }
  } finally {
    await prisma.$disconnect();
  }
})();
