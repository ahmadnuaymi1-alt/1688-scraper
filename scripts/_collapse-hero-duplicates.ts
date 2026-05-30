/**
 * Collapse duplicate hero ProductImage rows in the gallery for products
 * where multiple sister variants point at the same storagePath. Per group
 * of rows that share storagePath:
 *   1. Pick the LOWEST-position row as the canonical hero.
 *   2. Set its variantId to null (product-level).
 *   3. Update every variant whose featuredImageId points at a deleted row
 *      to point at the canonical row instead.
 *   4. Delete the other rows.
 *
 * Does NOT touch Supabase storage — the underlying PNG is still referenced
 * by the kept row, so leaving the storage untouched is correct.
 *
 * Usage:
 *   npx tsx scripts/_collapse-hero-duplicates.ts --products id1,id2,...
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

function parseArgs(): { productIds: string[] } {
  const argv = process.argv.slice(2);
  let productIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--products") {
      const raw = argv[++i] ?? "";
      productIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (productIds.length === 0) {
    console.error("Usage: --products id1,id2,...");
    process.exit(1);
  }
  return { productIds };
}

const prisma = new PrismaClient();

(async () => {
  const { productIds } = parseArgs();
  for (const productId of productIds) {
    const heroes = await prisma.productImage.findMany({
      where: { productId, imageType: { in: ["hero", "hero-flat"] } },
      select: { id: true, storagePath: true, position: true, variantId: true },
      orderBy: { position: "asc" },
    });
    if (heroes.length === 0) {
      console.log(`${productId}: no heroes`);
      continue;
    }
    const byPath = new Map<string, typeof heroes>();
    for (const h of heroes) {
      const key = h.storagePath ?? `__id_${h.id}`;
      const arr = byPath.get(key) ?? [];
      arr.push(h);
      byPath.set(key, arr);
    }
    let collapsed = 0;
    for (const [key, group] of byPath) {
      if (group.length < 2) continue;
      // Keep the lowest-position row as canonical.
      const canonical = group[0];
      const dropIds = group.slice(1).map((g) => g.id);
      // Re-point any variant whose featuredImageId is a dropped row.
      await prisma.variant.updateMany({
        where: { productId, featuredImageId: { in: dropIds } },
        data: { featuredImageId: canonical.id },
      });
      // Make canonical product-level.
      await prisma.productImage.update({
        where: { id: canonical.id },
        data: { variantId: null },
      });
      await prisma.productImage.deleteMany({ where: { id: { in: dropIds } } });
      collapsed += dropIds.length;
      console.log(`  ${productId}/${key.slice(-50)}: kept ${canonical.id} (pos=${canonical.position}), deleted ${dropIds.length} duplicate(s)`);
    }
    console.log(`${productId}: collapsed ${collapsed} duplicate hero row(s)`);
  }
  await prisma.$disconnect();
})();
