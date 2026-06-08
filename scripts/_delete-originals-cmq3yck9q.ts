/**
 * Delete 1688 originals for cmq3yck9q000jw2q03468fge7.
 * Filter mirrors /api/products/[id]/delete-originals:
 * imageType=null + keep=false + (host endsWith .alicdn.com OR storagePath under product dir but not heroes/lifestyles)
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

const PID = "cmq3yck9q000jw2q03468fge7";

async function main() {
  const prisma = new PrismaClient();

  const before = await prisma.productImage.findMany({
    where: { productId: PID },
    select: { id: true, imageType: true, keep: true, storagePath: true, sourceUrl: true },
  });
  console.log(`Total images before: ${before.length}`);
  for (const i of before) {
    console.log(`  ${i.id} type=${i.imageType ?? "null"} keep=${i.keep} ${i.storagePath ?? i.sourceUrl ?? ""}`);
  }

  // Delete: imageType IS NULL, keep=false. These are the 1688 originals.
  const toDelete = before.filter(i => i.imageType === null && !i.keep);
  console.log(`\nTo delete: ${toDelete.length} 1688 originals (imageType=null, keep=false)`);
  const kept = before.filter(i => i.imageType === null && i.keep);
  console.log(`To keep (starred): ${kept.length}`);

  // Detach variants pointing at these
  for (const img of toDelete) {
    await prisma.variant.updateMany({
      where: { featuredImageId: img.id },
      data: { featuredImageId: null },
    });
  }

  const result = await prisma.productImage.deleteMany({
    where: {
      productId: PID,
      imageType: null,
      keep: false,
    },
  });
  console.log(`\nDeleted: ${result.count}`);

  const after = await prisma.productImage.findMany({
    where: { productId: PID },
    select: { id: true, imageType: true },
  });
  const counts = after.reduce((acc, i) => { const k = i.imageType ?? "null"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  console.log(`\nAfter — total: ${after.length}`);
  console.log(`Counts by type: ${JSON.stringify(counts)}`);

  console.log(`\nDeleted=${result.count}  Kept=${kept.length}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
