/**
 * Purge contaminated generated images for a product — deletes every
 * ProductImage row whose imageType is hero / hero-flat / lifestyle (the
 * AI-generated ones), and nulls any Variant.featuredImageId that pointed at a
 * deleted row. Leaves the original scraped source images (imageType null)
 * untouched.
 *
 * Usage: npx tsx scripts/_purge-contaminated-images.ts <productId> [types]
 *   types — optional comma-separated imageType list to delete.
 *           Defaults to "hero,hero-flat,lifestyle". Pass e.g. "lifestyle" to
 *           delete only lifestyle rows and leave heroes intact.
 *
 * Reason: an earlier hero run generated golf-simulator images (bad Higgsfield
 * reference handling); those poisoned heroes then fed the lifestyle generator.
 * Everything generated must be wiped so heroes can be regenerated cleanly.
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

const DEFAULT_PURGE_TYPES = ["hero", "hero-flat", "lifestyle"];

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: npx tsx scripts/_purge-contaminated-images.ts <productId> [types]");
    process.exit(1);
  }
  const PURGE_TYPES = process.argv[3]
    ? process.argv[3].split(",").map((t) => t.trim()).filter(Boolean)
    : DEFAULT_PURGE_TYPES;
  console.log(`Purging imageType(s): ${PURGE_TYPES.join(", ")}`);
  const prisma = new PrismaClient();
  try {
    const doomed = await prisma.productImage.findMany({
      where: { productId, imageType: { in: PURGE_TYPES } },
      select: { id: true, imageType: true, fileName: true },
    });
    if (doomed.length === 0) {
      console.log("No contaminated (hero/hero-flat/lifestyle) rows found — nothing to purge.");
      return;
    }
    console.log(`Found ${doomed.length} generated ProductImage row(s) to delete:`);
    for (const d of doomed) console.log(`  ${d.id} | ${d.imageType} | ${d.fileName ?? "-"}`);
    const doomedIds = new Set(doomed.map((d) => d.id));

    // Null any Variant.featuredImageId pointing at a doomed row.
    const variants = await prisma.variant.findMany({
      where: { productId },
      select: { id: true, featuredImageId: true },
    });
    let nulled = 0;
    for (const v of variants) {
      if (v.featuredImageId && doomedIds.has(v.featuredImageId)) {
        await prisma.variant.update({ where: { id: v.id }, data: { featuredImageId: null } });
        nulled++;
      }
    }
    console.log(`\nCleared featuredImageId on ${nulled} variant(s).`);

    const del = await prisma.productImage.deleteMany({
      where: { id: { in: [...doomedIds] } },
    });
    console.log(`Deleted ${del.count} ProductImage row(s).`);
    console.log(
      `\nNote: the corresponding files in Supabase storage are now orphaned (harmless — ` +
        `nothing references them). The original scraped source images were left intact.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
