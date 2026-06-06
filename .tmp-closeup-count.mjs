import { config } from 'dotenv';
config({ path: '.env.local' });
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const productId = 'cmpzifo4s003uw2hsxm35vqyf';
const images = await prisma.productImage.findMany({
  where: { productId },
  select: { id: true, imageType: true, variantId: true, storagePath: true, sourceUrl: true },
});
const closeups = images.filter(i => i.imageType === 'closeup');
console.log('TOTAL_IMAGES=' + images.length);
console.log('CLOSEUP_COUNT=' + closeups.length);
for (const c of closeups) console.log(' closeup:', c.id, '|', c.storagePath || c.sourceUrl);
await prisma.$disconnect();
