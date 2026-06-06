/**
 * Inspect product cmpvdulx5005nw2hkaid59oes:
 *  - List 6 variants with id, title, featuredImageId, and storagePath of that featured image
 *  - Count UNIQUE storagePaths across the variants' featured images (== correct hero count)
 *  - Count existing hero-flat ProductImage rows for this product
 *  - Flag any variants with NULL featuredImageId
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

const PRODUCT_ID = "cmpvdulx5005nw2hkaid59oes";

async function main() {
  const prisma = new PrismaClient();
  try {
    const product = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { id: true, title: true },
    });
    console.log(`Product: ${product?.id} — ${product?.title ?? "(not found)"}\n`);

    const variants = await prisma.variant.findMany({
      where: { productId: PRODUCT_ID },
      select: { id: true, title: true, position: true, isHidden: true, featuredImageId: true },
      orderBy: { position: "asc" },
    });
    console.log(`=== ${variants.length} Variant row(s) ===`);

    const featuredIds = variants.map((v) => v.featuredImageId).filter((x): x is string => !!x);
    const featuredImages = featuredIds.length
      ? await prisma.productImage.findMany({
          where: { id: { in: featuredIds } },
          select: { id: true, storagePath: true, imageType: true, sourceUrl: true, fileName: true },
        })
      : [];
    const featuredById = new Map(featuredImages.map((f) => [f.id, f] as const));

    const nullVariants: string[] = [];
    const storagePathsSeen = new Set<string>();
    for (const v of variants) {
      const f = v.featuredImageId ? featuredById.get(v.featuredImageId) : undefined;
      const sp = f?.storagePath ?? null;
      if (!v.featuredImageId) nullVariants.push(v.id);
      if (sp) storagePathsSeen.add(sp);
      console.log(`  [${v.id}] pos=${v.position} hidden=${v.isHidden}`);
      console.log(`     title=${v.title}`);
      console.log(`     featuredImageId=${v.featuredImageId ?? "NULL"}`);
      console.log(`     featured.storagePath=${sp ?? "-"}`);
      console.log(`     featured.imageType=${f?.imageType ?? "-"}`);
      console.log(`     featured.fileName=${f?.fileName ?? "-"}`);
    }

    console.log(`\n=== Unique storagePaths across the ${variants.length} variants' featured images ===`);
    console.log(`  count=${storagePathsSeen.size}`);
    for (const sp of storagePathsSeen) console.log(`    - ${sp}`);

    console.log(`\n=== Variants with NULL featuredImageId ===`);
    if (nullVariants.length === 0) console.log("  none");
    else for (const id of nullVariants) console.log(`  - ${id}`);

    // Inspect hero-flat ProductImage rows. Possible imageType values vary, so search
    // for anything that looks like a hero on this product.
    const allImages = await prisma.productImage.findMany({
      where: { productId: PRODUCT_ID },
      select: {
        id: true,
        imageType: true,
        variantId: true,
        storagePath: true,
        fileName: true,
        sourceUrl: true,
        createdAt: true,
      },
      orderBy: [{ imageType: "asc" }, { position: "asc" }],
    });

    const typeCounts = new Map<string, number>();
    for (const r of allImages) {
      const k = r.imageType ?? "null";
      typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
    }
    console.log(`\n=== ProductImage imageType counts (all rows for this product) ===`);
    for (const [k, n] of typeCounts) console.log(`  ${k}: ${n}`);

    // Look for hero-flat specifically — try common type strings
    const heroFlats = allImages.filter((r) => {
      const t = (r.imageType ?? "").toLowerCase();
      return t.includes("hero_flat") || t === "hero" || t.includes("hero-flat") || t.includes("heroflat");
    });
    console.log(`\n=== Hero-flat-looking rows ===`);
    console.log(`  count=${heroFlats.length}`);
    for (const r of heroFlats) {
      console.log(`  [${r.id}] type=${r.imageType} variant=${r.variantId ?? "-"} file=${r.fileName ?? "-"}`);
      console.log(`     storagePath=${r.storagePath ?? "-"}`);
      console.log(`     sourceUrl=${(r.sourceUrl ?? "-").slice(0, 120)}`);
      console.log(`     created=${r.createdAt.toISOString().slice(0, 19)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
