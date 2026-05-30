/**
 * Look up the ProductImage at specific positions on the review-page grid
 * for the 4 hero-redo targets. Prints the variant(s) sharing that hero so
 * we know whose featuredImageId needs nulling on retry.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

// (productId, gallery position) pairs from the user's screenshots.
// The review-page grid uses 1-based "#N" labels matching ProductImage.position.
const TARGETS: Array<{ productId: string; positions: number[]; note: string }> = [
  { productId: "cmppv892200t9w2vsh5vgmgmg", positions: [], note: "whole product (light too high)" },
  { productId: "cmppqiiol00f1w2vsgq039299", positions: [], note: "whole product (user said redo entirely)" },
  { productId: "cmppqhueh00amw2vsdewbgxhs", positions: [19, 23, 25], note: "specific tiles too high / too small" },
  { productId: "cmppqgw3z005mw2vsplzfocnl", positions: [24], note: "Chinese text leaked + off-center" },
];

(async () => {
  for (const t of TARGETS) {
    console.log(`\n=== ${t.productId} — ${t.note} ===`);
    if (t.positions.length === 0) {
      const heroCount = await prisma.productImage.count({
        where: { productId: t.productId, imageType: { in: ["hero", "hero-flat"] } },
      });
      console.log(`  whole-product redo, currently ${heroCount} hero(es)/hero-flat(s)`);
      continue;
    }
    for (const pos of t.positions) {
      const img = await prisma.productImage.findFirst({
        where: { productId: t.productId, position: pos },
        select: { id: true, imageType: true, storagePath: true, variantId: true },
      });
      if (!img) {
        console.log(`  #${pos}: NO IMAGE FOUND at position ${pos}`);
        continue;
      }
      // Find all sister images with the same storagePath (variants sharing this hero).
      const sisters = img.storagePath
        ? await prisma.productImage.findMany({
            where: { productId: t.productId, storagePath: img.storagePath },
            select: { id: true, position: true, variantId: true },
            orderBy: { position: "asc" },
          })
        : [{ id: img.id, position: pos, variantId: img.variantId }];
      const variantIds = sisters
        .map((s) => s.variantId)
        .filter((v): v is string => !!v);
      const variantTitles = await prisma.variant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, title: true },
      });
      const titleMap = new Map(variantTitles.map((v) => [v.id, v.title]));
      const variantSummary = sisters
        .map(
          (s) =>
            `pos#${s.position}=${s.variantId ? titleMap.get(s.variantId)?.slice(0, 30) ?? "?" : "no-var"}`,
        )
        .join(", ");
      console.log(
        `  #${pos}: ProductImage=${img.id} type=${img.imageType ?? "null"} storagePath=${img.storagePath?.slice(-60) ?? "—"}`,
      );
      console.log(`        sisters=[${variantSummary}]`);
    }
  }
  await prisma.$disconnect();
})();
