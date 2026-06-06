import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const productIds = [
  "cmpspbahc00c6w24cjae7uv6j",
  "cmpspad7h0096w24cnrxdgycr",
  "cmpspa7wm0075w24ccqg9mzbn",
  "cmpsp9wh7004ww24cr1n8oeki",
  "cmpsp9ppg002uw24chlb1gvmx",
  "cmpsp94gm001nw24cpwbzd5o0"
];

console.log("\nHERO ANALYSIS:");
console.log("==============");
for (const pid of productIds) {
  const product = await prisma.product.findUnique({
    where: { id: pid },
    select: {
      id: true,
      title: true,
      variants: { select: { id: true, title: true } },
      images: { select: { id: true, imageType: true, variantId: true, fileName: true } }
    }
  });

  if (!product) continue;

  const variantCount = product.variants.length;
  
  // Heroes with variantId (old style — per-variant)
  const heroesPerVariant = product.images.filter(
    img => (img.imageType === "hero" || img.imageType === "hero-flat") && img.variantId
  );
  
  // Heroes without variantId (new style — product-level)
  const heroesProductLevel = product.images.filter(
    img => (img.imageType === "hero" || img.imageType === "hero-flat") && !img.variantId
  );
  
  const totalHeroes = heroesPerVariant.length + heroesProductLevel.length;

  console.log(`\n${pid.slice(0,12)}... | ${product.title.slice(0,40)}`);
  console.log(`  Variants: ${variantCount}`);
  console.log(`  Heroes (per-variant, variantId!=null): ${heroesPerVariant.length}`);
  if (heroesPerVariant.length > 0) {
    for (const h of heroesPerVariant) {
      console.log(`    - ${h.id.slice(0,8)}: variant=${product.variants.find(v=>v.id===h.variantId)?.title || 'unknown'}`);
    }
  }
  console.log(`  Heroes (product-level, variantId=null): ${heroesProductLevel.length}`);
  if (heroesProductLevel.length > 0) {
    for (const h of heroesProductLevel) {
      console.log(`    - ${h.id.slice(0,8)}: ${h.fileName || 'no-filename'}`);
    }
  }
  console.log(`  TOTAL HEROES: ${totalHeroes}  (should be ≤ unique variant image URLs)`);
}

await prisma.$disconnect();
