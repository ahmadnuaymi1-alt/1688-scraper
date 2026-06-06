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

for (const pid of productIds) {
  const product = await prisma.product.findUnique({
    where: { id: pid },
    select: {
      id: true,
      title: true,
      lifestyleUnitMode: true,
      variants: { select: { id: true } },
      images: { select: { id: true, imageType: true, variantId: true, sourceUrl: true } }
    }
  });

  if (!product) {
    console.log(`${pid}: NOT FOUND`);
    continue;
  }

  const variantCount = product.variants.length;
  
  // Count unique variant sourceUrls
  const variantSourceUrls = new Set();
  for (const img of product.images) {
    if (img.variantId && img.sourceUrl) {
      variantSourceUrls.add(img.sourceUrl);
    }
  }
  
  const heroCount = product.images.filter(
    img => img.imageType === "hero" || img.imageType === "hero-flat"
  ).length;
  
  const lifestyleCount = product.images.filter(
    img => img.imageType === "lifestyle"
  ).length;
  
  const closeupCount = product.images.filter(
    img => img.imageType === "closeup"
  ).length;

  console.log(`${pid.slice(0,12)}... | ${product.title.slice(0,50).padEnd(50)} | variants=${variantCount} | heroes=${heroCount} | lifestyles=${lifestyleCount} | closeups=${closeupCount} | unitMode=${product.lifestyleUnitMode || 'auto'}`);
}

await prisma.$disconnect();
