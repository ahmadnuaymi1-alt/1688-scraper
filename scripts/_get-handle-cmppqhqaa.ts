import { config } from 'dotenv';
config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
(async () => {
  const r = await p.product.findUnique({ where: { id: 'cmppqhqaa009mw2vslvgoavnn' } });
  console.log(JSON.stringify({
    handle: (r as any)?.handle,
    shopifyHandle: (r as any)?.shopifyHandle,
    slug: (r as any)?.slug,
    title: r?.title,
    status: (r as any)?.status,
  }, null, 2));
  await p.$disconnect();
})();
