import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const problematicProducts = [
  "cmpspa7wm0075w24ccqg9mzbn",  // 8 variants, 6 heroes
  "cmpsp9wh7004ww24cr1n8oeki"   // 2 variants, 2 heroes
];

for (const pid of problematicProducts) {
  console.log(`\n=== ${pid} ===`);
  
  const product = await prisma.product.findUnique({
    where: { id: pid },
    select: {
      variants: { 
        select: { id: true, title: true, position: true, featuredImageId: true },
        orderBy: { position: "asc" }
      },
      images: { 
        select: { id: true, imageType: true, fileName: true }
      }
    }
  });

  const heroesById = new Map(
    product.images
      .filter(img => img.imageType === "hero" || img.imageType === "hero-flat")
      .map(img => [img.id, img.fileName])
  );

  console.log(`\nVariant → featuredImageId mapping:`);
  const heroIdCounts = new Map();
  for (const v of product.variants) {
    const heroFile = heroesById.get(v.featuredImageId) || "NOT_HERO";
    console.log(`  pos=${v.position.toString().padStart(2)} ${v.title.padEnd(30)} → featuredImageId=${v.featuredImageId ? v.featuredImageId.slice(0,8) : 'NULL'} (${heroFile})`);
    if (v.featuredImageId) {
      heroIdCounts.set(v.featuredImageId, (heroIdCounts.get(v.featuredImageId) || 0) + 1);
    }
  }
  
  console.log(`\nHero reuse counts (unique hero IDs, how many variants point to each):`);
  for (const [heroId, count] of heroIdCounts) {
    const fileName = heroesById.get(heroId);
    if (count > 1) {
      console.log(`  ${heroId.slice(0,8)} (${fileName}) ← shared by ${count} variants`);
    }
  }
}

await prisma.$disconnect();
