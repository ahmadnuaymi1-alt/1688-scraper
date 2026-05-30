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

const prisma = new PrismaClient();

(async () => {
  const PRODUCT_ID = "cmpr6sedo002vw2wog3u1ojmh";
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) { console.log("not found"); return; }
  console.log(`Title: ${product.title.slice(0, 80)}\n`);

  const imagesById = new Map(product.images.map((i) => [i.id, i]));

  // What the bulk-heroes script does: source images = non-hero/non-hero-flat
  const sourceImages = product.images.filter(
    (img) => img.imageType !== "hero" && img.imageType !== "hero-flat",
  );
  console.log(`Source-pool images (non-hero, non-hero-flat): ${sourceImages.length}`);
  console.log(`  Of those, lifestyle: ${sourceImages.filter((i) => i.imageType === "lifestyle").length}`);
  console.log(`  Of those, closeup:   ${sourceImages.filter((i) => i.imageType === "closeup").length}`);
  console.log(`  Of those, null type: ${sourceImages.filter((i) => i.imageType === null).length}\n`);

  const imagesByVariant = new Map<string, typeof product.images[number]>();
  for (const img of sourceImages) {
    if (!img.variantId) continue;
    if (!imagesByVariant.has(img.variantId)) imagesByVariant.set(img.variantId, img);
  }
  for (const v of product.variants) {
    if (imagesByVariant.has(v.id)) continue;
    if (v.featuredImageId) {
      const img = imagesById.get(v.featuredImageId);
      if (img && sourceImages.includes(img)) imagesByVariant.set(v.id, img);
    }
  }

  // Per variant, what source image does it map to?
  console.log(`Variants → source image mapping:`);
  for (const v of product.variants) {
    const img = imagesByVariant.get(v.id);
    const key = img ? (img.storagePath ?? img.sourceUrl).slice(-60) : "(NO SOURCE)";
    console.log(`  pos=${v.position}  opts=[${v.option1}|${v.option2}]  → ${key}`);
  }

  // Now compute unique groups by storagePath || sourceUrl (what the bulk script does)
  const groupKeys = new Set<string>();
  for (const [, img] of imagesByVariant) {
    groupKeys.add(img.storagePath || img.sourceUrl);
  }
  console.log(`\nUnique source-image groups: ${groupKeys.size}`);

  // What heroes ACTUALLY got created for this product?
  const heroes = product.images.filter((i) => i.imageType === "hero" || i.imageType === "hero-flat");
  const heroStorage = new Set(heroes.map((h) => h.storagePath));
  console.log(`Hero / hero-flat ProductImage rows: ${heroes.length}`);
  console.log(`Unique hero storagePaths: ${heroStorage.size}`);
  console.log(`\nHero rows:`);
  for (const h of heroes) {
    console.log(`  pos=${h.position}  variant=${h.variantId?.slice(-6) ?? "—"}  path=${h.storagePath?.slice(-70)}`);
  }

  await prisma.$disconnect();
})();
