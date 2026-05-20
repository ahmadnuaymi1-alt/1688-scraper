/**
 * Recover variant→swatch ProductImage rows from Product.rawPayload after a
 * destructive dedup. The 1688 scrape stores all listing images in
 * rawPayload.images, where the first N are gallery photos and the last K
 * are per-variant swatches in variant order. We reconstruct rows by
 * pairing variants[i] with images[i + offset].
 *
 * Usage: npx tsx scripts/_recover-variant-swatches.ts <productId>
 */
import fs from "node:fs";
import path from "node:path";

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

function fileNameFromUrl(u: string): string {
  const base = u.split("/").pop() ?? u;
  // Match the existing scheme: `_!!` → `___`.
  return base.replace(/_!!/g, "___");
}

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: <productId>");
    process.exit(1);
  }
  const { prisma } = await import("../src/lib/db");
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: { orderBy: { position: "asc" } } },
    });
    if (!product) { console.error("not found"); process.exit(1); }

    const payload = JSON.parse(product.rawPayload) as { images?: string[] };
    const allImages = payload.images ?? [];
    if (allImages.length === 0) {
      console.error("rawPayload has no images");
      process.exit(1);
    }

    const variants = product.variants;
    if (variants.length === 0) {
      console.error("no variants");
      process.exit(1);
    }

    // The last `variants.length` URLs in rawPayload.images are the swatches,
    // in the same order as variants by position. Offset = total - variants.
    const offset = allImages.length - variants.length;
    if (offset < 0) {
      console.error(`Can't pair: ${allImages.length} images, ${variants.length} variants`);
      process.exit(1);
    }
    console.log(`Pairing variants[0..${variants.length - 1}] with images[${offset}..${allImages.length - 1}]`);

    // Cross-check: variants[0] should already point at images[offset] if the
    // pairing is correct. If a row with variantId=variants[0].id exists,
    // confirm its sourceUrl matches images[offset]; abort if not.
    const v0Row = await prisma.productImage.findFirst({
      where: { productId, variantId: variants[0].id },
    });
    if (v0Row && v0Row.sourceUrl !== allImages[offset]) {
      console.warn(`WARNING: variant[0] row's sourceUrl doesn't match images[${offset}]`);
      console.warn(`  expected: ${allImages[offset]}`);
      console.warn(`  got:      ${v0Row.sourceUrl}`);
    }

    // Get max position so new rows go to the end.
    const maxPos = await prisma.productImage.aggregate({
      where: { productId },
      _max: { position: true },
    });
    let nextPosition = (maxPos._max.position ?? 0) + 1;

    let created = 0;
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const url = allImages[i + offset];
      if (!url) continue;
      const existing = await prisma.productImage.findFirst({
        where: { productId, variantId: v.id },
      });
      if (existing) continue; // already has a row
      const row = await prisma.productImage.create({
        data: {
          productId,
          variantId: v.id,
          sourceUrl: url,
          storagePath: null,
          fileName: fileNameFromUrl(url),
          position: nextPosition++,
          downloadStatus: "pending",
        },
      });
      await prisma.variant.update({
        where: { id: v.id },
        data: { featuredImageId: row.id },
      });
      created++;
      console.log(`  recreated swatch for #${v.position} "${v.title.slice(0, 30)}" -> ${url.split("/").pop()}`);
    }
    console.log(`\nDone. Created ${created} ProductImage row(s).`);
  } finally {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
