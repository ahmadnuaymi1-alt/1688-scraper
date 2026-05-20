/**
 * Retroactively dedupe variant swatch images for an existing product.
 *
 * Usage:
 *   npx tsx scripts/dedupe-variant-swatches.ts <productId>
 *
 * Calls the same `dedupeVariantSwatches()` function the scrape pipeline
 * runs in Phase 1, so the result is identical to what a re-scrape would
 * produce — without re-downloading anything.
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: npx tsx scripts/dedupe-variant-swatches.ts <productId>");
    process.exit(1);
  }
  const { dedupeVariantSwatches } = await import("../src/lib/scraper/dedupe-variant-swatches");
  const { prisma } = await import("../src/lib/db");
  try {
    const before = await prisma.productImage.count({
      where: { productId, variantId: { not: null } },
    });
    console.log(`Before: ${before} ProductImage row(s) with variantId set`);
    const result = await dedupeVariantSwatches(productId);
    console.log("Result:", result);
    const after = await prisma.productImage.count({
      where: { productId, variantId: { not: null } },
    });
    console.log(`After:  ${after} ProductImage row(s) with variantId set`);
  } finally {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
