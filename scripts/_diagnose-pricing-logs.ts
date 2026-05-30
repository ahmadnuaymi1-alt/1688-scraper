/**
 * For each of the 9 successful recent scrapes (5/28 fan-light batch + 5/27
 * bag batch), print:
 *   - JobLog entries that mention "pricing"
 *   - Whether any variant has price > 0
 *   - Whether PricingNotes / aiPricingRationale exists on the product
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

const IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
  "cmpoa6pcq004hw2e0tqd10du2",
  "cmpoa6cdm001kw2e0lwlzfoin",
  "cmpoa6ab30015w2e0q6oomwy8",
];

(async () => {
  for (const productId of IDS) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        pricingNotes: true,
        scrapeJob: { select: { id: true } },
        variants: {
          where: { isHidden: false },
          select: { id: true, price: true, compareAtPrice: true },
          take: 5,
        },
      },
    });
    if (!product) {
      console.log(`${productId} | NOT FOUND`);
      continue;
    }
    const variantsWithPrice = product.variants.filter(
      (v) => v.price !== null && Number(v.price) > 0,
    ).length;
    const samplePrice = product.variants[0]?.price ?? null;
    const sampleCompareAt = product.variants[0]?.compareAtPrice ?? null;
    console.log(
      `${productId} | pricedVariants=${variantsWithPrice}/${product.variants.length} | samplePrice=${samplePrice} | sampleCompareAt=${sampleCompareAt} | pricingNotes=${product.pricingNotes ? `${product.pricingNotes.slice(0, 60)}...` : "null"}`,
    );
    if (product.scrapeJob) {
      const logs = await prisma.jobLog.findMany({
        where: {
          scrapeJobId: product.scrapeJob.id,
          message: { contains: "pricing", mode: "insensitive" },
        },
        select: { level: true, message: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (logs.length === 0) {
        console.log(`    pricing logs: (none — pricing step did NOT execute)`);
      } else {
        for (const log of logs) {
          console.log(`    [${log.level}] ${log.message.slice(0, 200)}`);
        }
      }
    }
  }
  await prisma.$disconnect();
})();
