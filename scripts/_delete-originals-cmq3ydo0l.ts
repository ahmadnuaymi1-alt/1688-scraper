/**
 * Delete original 1688 ProductImages for cmq3ydo0l000jw288ns3doet5.
 * Mirrors src/app/api/products/[id]/delete-originals/route.ts logic:
 *   delete ProductImage where productId=ID AND imageType=null AND keep=false
 *   AND host endsWith .alicdn.com (originals only).
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

const PID = "cmq3ydo0l000jw288ns3doet5";

async function main() {
  const prisma = new PrismaClient();

  // Find candidates
  const candidates = await prisma.productImage.findMany({
    where: { productId: PID, imageType: null, keep: false },
    select: { id: true, sourceUrl: true, storagePath: true },
  });

  const isAlicdn = (url: string | null | undefined) => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.hostname.endsWith(".alicdn.com") || u.hostname === "alicdn.com";
    } catch {
      return false;
    }
  };

  const toDelete = candidates.filter((c) => isAlicdn(c.sourceUrl));

  console.log(`Found ${candidates.length} candidate(s) (imageType=null, keep=false).`);
  console.log(`Of those, ${toDelete.length} are .alicdn.com originals.`);

  // Kept count: any ProductImage with keep=true, or non-null imageType (hero/lifestyle)
  const kept = await prisma.productImage.count({
    where: { productId: PID, keep: true },
  });

  if (toDelete.length === 0) {
    console.log("Nothing to delete.");
    await prisma.$disconnect();
    console.log(JSON.stringify({ deleted: 0, kept }));
    return;
  }

  const ids = toDelete.map((c) => c.id);
  const del = await prisma.productImage.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted ${del.count} ProductImage rows.`);
  console.log(JSON.stringify({ deleted: del.count, kept }));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
