/**
 * Show every variant of a product (including hidden), its source images,
 * and what featuredImageId currently points at.
 * Usage: npx tsx scripts/_inspect-variants.ts <productId>
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
    const variants = await prisma.variant.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      include: { featuredImage: true },
    });
    console.log(`${variants.length} variants total`);
    for (const v of variants) {
      const ownImages = await prisma.productImage.findMany({
        where: { productId, variantId: v.id },
        select: { id: true, imageType: true, fileName: true, sourceUrl: true },
      });
      const ownNames = ownImages.map(i => `${i.imageType ?? "null"}:${(i.fileName ?? "").slice(0, 30)}`).join(", ");
      console.log(`  #${v.position} ${v.isHidden ? "[HIDDEN]" : ""} "${(v.title || "").slice(0, 30)}" feat=${v.featuredImage?.fileName?.slice(0, 30) ?? "-"} (${v.featuredImage?.imageType ?? "-"}) own=[${ownNames}]`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
