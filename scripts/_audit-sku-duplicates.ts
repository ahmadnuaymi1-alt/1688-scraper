/**
 * Find any duplicate SKUs across ALL products in the DB. Read-only.
 *   npx tsx scripts/_audit-sku-duplicates.ts
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
  const prisma = new PrismaClient();
  const variants = await prisma.variant.findMany({
    where: { sku: { not: null } },
    select: { id: true, sku: true, productId: true, position: true, option1: true, option2: true, option3: true },
  });
  process.stdout.write(`Total variants with SKUs: ${variants.length}\n`);

  const bySku = new Map<string, typeof variants>();
  for (const v of variants) {
    const sku = v.sku!.trim();
    if (!sku) continue;
    if (!bySku.has(sku)) bySku.set(sku, []);
    bySku.get(sku)!.push(v);
  }

  const dupes = Array.from(bySku.entries()).filter(([, vs]) => vs.length > 1);
  if (dupes.length === 0) {
    process.stdout.write(`\n✓ No duplicate SKUs.\n`);
    await prisma.$disconnect();
    return;
  }

  process.stdout.write(`\n⚠ Found ${dupes.length} duplicate SKU(s) covering ${dupes.reduce((a, [, vs]) => a + vs.length, 0)} variants:\n\n`);
  // Sort by number of variants per SKU, descending
  dupes.sort((a, b) => b[1].length - a[1].length);
  for (const [sku, vs] of dupes.slice(0, 50)) {
    process.stdout.write(`SKU "${sku}" appears ${vs.length} times:\n`);
    for (const v of vs.slice(0, 6)) {
      const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      process.stdout.write(`  product=${v.productId}  pos=${v.position}  (${opts})\n`);
    }
    if (vs.length > 6) process.stdout.write(`  ... +${vs.length - 6} more\n`);
  }
  if (dupes.length > 50) process.stdout.write(`\n... +${dupes.length - 50} more duplicate SKU groups\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
