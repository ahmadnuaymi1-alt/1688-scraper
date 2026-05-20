/**
 * Delete all hero-flat ProductImage rows for a product. Used before regenerating
 * heroes so the gallery doesn't accumulate duplicates.
 *
 * Usage: npx tsx scripts/_delete-hero-flats.ts <productId>
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

async function main() {
  const productId = process.argv[2];
  if (!productId) { console.error("Usage: <productId>"); process.exit(1); }
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.productImage.findMany({
      where: { productId, imageType: { in: ["hero", "hero-flat"] } },
      select: { id: true, fileName: true, imageType: true },
    });
    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      const k = r.imageType ?? "(null)";
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`Found ${rows.length} hero/hero-flat row(s) for ${productId} — ${JSON.stringify(byType)}`);
    if (rows.length === 0) return;
    // Null out any variant.featuredImageId pointing at these rows
    const ids = rows.map(r => r.id);
    const cleared = await prisma.variant.updateMany({
      where: { productId, featuredImageId: { in: ids } },
      data: { featuredImageId: null },
    });
    console.log(`Cleared featuredImageId from ${cleared.count} variant(s)`);
    const deleted = await prisma.productImage.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`Deleted ${deleted.count} hero-flat row(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
