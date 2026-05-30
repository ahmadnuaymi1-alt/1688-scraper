/**
 * ONE-OFF: Prepare cmpigpnld + cmpigm5x7 for a fresh Higgsfield hero re-run
 * WITHOUT deleting any existing rows. Approach (per the user's explicit
 * choice — keep old heroes too):
 *   1. Relabel today's existing imageType="hero" rows to "hero-flat" so the
 *      hero script's idempotency check (which only looks at "hero") does not
 *      skip. These rows remain in the gallery as history.
 *   2. Clear variantId on those relabeled rows so they don't shadow the
 *      original 1688 source images in the script's variantId→image lookup.
 *   3. For cmpigm5x7 White only: also clear variantId on the older hero-flat
 *      (pos 0, from a prior session) for the same reason — otherwise White's
 *      lookup picks that older hero-flat as its reference instead of the
 *      original source image.
 *
 * Variant.featuredImageId is left pointing at today's (now-hero-flat) rows;
 * the hero script will overwrite it with the new hero anyway.
 *
 * Safe to delete after running.
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

const PRODUCT_IDS = [
  "cmpigpnld00t5w2f0za0e7qgt",
  "cmpigm5x700erw2f00pepmyc6",
];

// cmpigm5x7 White's older hero-flat that would otherwise shadow the source.
const EXTRA_CLEAR_VARIANT_ID_ROW_IDS = [
  "cmpiilz1d0001w2wohwn167me", // pos 0 hero-flat from a prior session
];

async function main() {
  const prisma = new PrismaClient();
  for (const id of PRODUCT_IDS) {
    const heroRows = await prisma.productImage.findMany({
      where: { productId: id, imageType: "hero" },
      select: { id: true, position: true, variantId: true, sourceUrl: true },
    });
    console.log(`\n[${id}] Found ${heroRows.length} hero row(s) to relabel:`);
    for (const r of heroRows) {
      console.log(`  pos ${r.position} | ${r.id} | variantId=${r.variantId}`);
    }
    if (heroRows.length === 0) continue;
    await prisma.productImage.updateMany({
      where: { id: { in: heroRows.map((r) => r.id) } },
      data: { imageType: "hero-flat", variantId: null },
    });
    console.log(`  → relabeled ${heroRows.length} to hero-flat + cleared variantId`);
  }

  for (const rowId of EXTRA_CLEAR_VARIANT_ID_ROW_IDS) {
    const row = await prisma.productImage.findUnique({
      where: { id: rowId },
      select: { id: true, position: true, imageType: true, variantId: true },
    });
    if (!row) { console.log(`\n[extra] ${rowId} not found, skipping`); continue; }
    if (!row.variantId) { console.log(`\n[extra] ${rowId} already has variantId=null`); continue; }
    await prisma.productImage.update({
      where: { id: rowId },
      data: { variantId: null },
    });
    console.log(`\n[extra] ${rowId} (pos ${row.position}, type ${row.imageType}) — variantId cleared`);
  }

  console.log("\nDone. Run hero script next.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
