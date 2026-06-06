import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

(async () => {
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
  
  const jobs = await prisma.scrapeJob.findMany({
    where: {
      createdAt: { gte: eightHoursAgo },
      product: { isNot: null }
    },
    orderBy: { createdAt: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          optionNames: true,
          variants: {
            orderBy: { position: 'asc' },
            select: {
              position: true,
              title: true,
              option1: true,
              option2: true,
              option3: true,
              price: true,
              isHidden: true,
              featuredImage: { select: { storagePath: true } },
            },
          },
        },
      },
    },
  });

  console.log(`Found ${jobs.length} jobs from last 8 hours\n`);

  for (const job of jobs) {
    if (!job.product) continue;
    const p = job.product;
    const offer = job.sourceUrl.match(/offer\/(\d+)/)?.[1] || job.sourceUrl.substring(0, 20);
    const visible = p.variants.filter((v) => !v.isHidden);
    const hidden = p.variants.filter((v) => v.isHidden);
    const opts = p.optionNames ? JSON.parse(p.optionNames) : [];

    console.log(`\n[${offer}] ${p.id}`);
    console.log(`  title: ${p.title}`);
    console.log(`  options: ${JSON.stringify(opts)}`);
    console.log(`  visible/hidden: ${visible.length}/${hidden.length}`);
    
    for (const v of visible) {
      const o1 = v.option1 || '—';
      const o2 = v.option2 || '—';
      const o3 = v.option3 || '—';
      const imgTail = v.featuredImage?.storagePath ? v.featuredImage.storagePath.slice(-50) : 'no-image';
      console.log(`    [${String(v.position).padStart(2)}] ${v.title} | ${o1} / ${o2} / ${o3} | $${v.price} | img:${imgTail}`);
    }
    if (hidden.length > 0) {
      console.log(`    HIDDEN: ${hidden.length}`);
    }
  }

  await prisma.$disconnect();
})();
