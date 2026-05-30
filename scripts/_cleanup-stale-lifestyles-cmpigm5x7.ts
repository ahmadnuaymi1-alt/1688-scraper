/**
 * ONE-OFF: cmpigm5x7 accumulated 17 stale lifestyle rows across earlier
 * Higgsfield runs (some pointing at old prompts; some duplicates from a
 * failed run where the script attached previously-cached output files).
 *
 * Delete every ProductImage row with imageType="lifestyle" on this product
 * so we can regenerate a clean set of 6 via Kie with the new light language.
 * Storage objects are intentionally NOT deleted (cheap to leave; uploader is
 * driven by DB anyway).
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

const PRODUCT_ID = "cmpigm5x700erw2f00pepmyc6";

async function main() {
  const prisma = new PrismaClient();
  const stale = await prisma.productImage.findMany({
    where: { productId: PRODUCT_ID, imageType: "lifestyle" },
    orderBy: { position: "asc" },
    select: { id: true, position: true, sourceUrl: true },
  });
  console.log(`Found ${stale.length} stale lifestyle rows to delete:`);
  for (const s of stale) {
    console.log(`  pos ${s.position} | ${s.id} | ${s.sourceUrl?.slice(-50)}`);
  }
  const result = await prisma.productImage.deleteMany({
    where: { productId: PRODUCT_ID, imageType: "lifestyle" },
  });
  console.log(`\nDeleted ${result.count} rows.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
