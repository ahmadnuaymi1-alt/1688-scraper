import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// For cmpspa7wm0075w24ccqg9mzbn, let's see the source images
const pid = "cmpspa7wm0075w24ccqg9mzbn";

const product = await prisma.product.findUnique({
  where: { id: pid },
  select: {
    variants: { 
      select: { id: true, title: true, position: true },
      orderBy: { position: "asc" }
    },
    images: { 
      select: { 
        id: true, 
        imageType: true, 
        fileName: true, 
        variantId: true, 
        storagePath: true
      },
      orderBy: { position: "asc" }
    }
  }
});

console.log(`=== ${pid} ===`);
console.log(`\nSOURCE IMAGES (non-hero):`);
for (const img of product.images) {
  if (img.imageType === "hero" || img.imageType === "hero-flat") continue;
  const variant = product.variants.find(v => v.id === img.variantId);
  console.log(`  variantPos=${img.variantId ? product.variants.findIndex(v => v.id === img.variantId) : 'null'} ${img.fileName}`);
}

console.log(`\nHERO IMAGES:`);
for (const img of product.images) {
  if (img.imageType !== "hero" && img.imageType !== "hero-flat") continue;
  console.log(`  ${img.id.slice(0,8)}: ${img.fileName}`);
}

await prisma.$disconnect();
