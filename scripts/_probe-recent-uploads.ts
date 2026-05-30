/**
 * READ-ONLY: look at the most recent 8 UploadRecord rows + their products'
 * image rows to figure out (a) which upload of the latest 5 failed, and (b)
 * which product has duplicate-sourceUrl ProductImage rows that would cause
 * Shopify to receive the same hero multiple times.
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

async function main() {
  const prisma = new PrismaClient();
  const recent = await prisma.uploadRecord.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { product: { select: { id: true, title: true } } },
  });
  console.log(`\n=== ${recent.length} most recent UploadRecord rows ===`);
  for (const r of recent) {
    console.log(`  ${r.createdAt.toISOString()} | status=${r.status} | productId=${r.productId} | shopifyHandle=${r.shopifyHandle ?? "-"}`);
    console.log(`    title: ${r.product?.title?.slice(0, 70)}`);
    if (r.errorMessage) console.log(`    ERROR: ${r.errorMessage.slice(0, 200)}`);
  }

  // For each unique product in the recent set, check for duplicate sourceUrl
  // in its downloaded ProductImage rows (since that's what the uploader pushes).
  const productIds = [...new Set(recent.map((r) => r.productId))];
  console.log(`\n=== Duplicate-sourceUrl scan for ${productIds.length} products ===`);
  for (const pid of productIds) {
    const imgs = await prisma.productImage.findMany({
      where: { productId: pid, downloadStatus: "downloaded" },
      orderBy: { position: "asc" },
      select: { id: true, position: true, imageType: true, sourceUrl: true },
    });
    const bySource = new Map<string, typeof imgs>();
    for (const i of imgs) {
      const key = i.sourceUrl ?? "<null>";
      const list = bySource.get(key) ?? [];
      list.push(i);
      bySource.set(key, list);
    }
    const dupes = [...bySource.entries()].filter(([_, v]) => v.length > 1);
    if (dupes.length === 0) {
      console.log(`  ${pid}: ${imgs.length} downloaded images, no sourceUrl dupes`);
    } else {
      console.log(`  ${pid}: ${imgs.length} downloaded images, ${dupes.length} duplicate sourceUrl group(s):`);
      for (const [src, group] of dupes) {
        console.log(`    × ${group.length} → ${src?.slice(-70)}`);
        for (const g of group) {
          console.log(`         pos ${g.position} | type ${g.imageType} | id ${g.id}`);
        }
      }
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
