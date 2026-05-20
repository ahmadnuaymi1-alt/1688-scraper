/**
 * Inspect ProductImage rows + Variant featuredImage mapping for a product.
 * Usage: npx tsx scripts/_inspect-product-images.ts <productId>
 *
 * Read-only. Prints every image (id, type, variant, storagePath, sourceUrl)
 * and each visible variant's featuredImageId — so a contaminated reference
 * (e.g. a golf-sim image saved as a "hero") can be traced.
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
  if (!productId) {
    console.error("Usage: npx tsx scripts/_inspect-product-images.ts <productId>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });
    console.log(`Product: ${product?.id} — ${product?.title ?? "(not found)"}\n`);

    const images = await prisma.productImage.findMany({
      where: { productId },
      select: {
        id: true,
        imageType: true,
        variantId: true,
        position: true,
        fileName: true,
        storagePath: true,
        sourceUrl: true,
        createdAt: true,
      },
      orderBy: [{ imageType: "asc" }, { position: "asc" }],
    });
    console.log(`=== ${images.length} ProductImage row(s) ===`);
    for (const r of images) {
      console.log(
        `  [${r.id}] type=${r.imageType ?? "null"} variant=${r.variantId ?? "-"} pos=${r.position} ` +
          `created=${r.createdAt.toISOString().slice(0, 16)}`,
      );
      console.log(`      file=${r.fileName ?? "-"}`);
      console.log(`      storagePath=${r.storagePath ?? "-"}`);
      console.log(`      sourceUrl=${(r.sourceUrl ?? "-").slice(0, 120)}`);
    }

    const variants = await prisma.variant.findMany({
      where: { productId },
      select: { id: true, title: true, position: true, isHidden: true, featuredImageId: true },
      orderBy: { position: "asc" },
    });
    console.log(`\n=== ${variants.length} Variant row(s) ===`);
    for (const v of variants) {
      console.log(
        `  [${v.id}] pos=${v.position} hidden=${v.isHidden} featuredImageId=${v.featuredImageId ?? "-"}`,
      );
      console.log(`      title=${v.title}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
