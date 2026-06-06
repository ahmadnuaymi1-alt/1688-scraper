/**
 * Delete the 25 scrape jobs + their products that I bulk-scraped without
 * the user's explicit permission. Cascade removes the variants + images.
 *
 * Targets: jobs created in the last 60 minutes that match the 25 offer IDs
 * from the bulk re-scrape.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const OFFER_IDS = [
  "935997255860","1008724830559","797964575340","620374190700","867819198347",
  "838088785314","887151234993","609075854364","891975968101","1050619801202",
  "996926322946","657196961902","1013001591969","1007859812400","884173459922",
  "1041633376980","651736472000","1036141567501","898685737610","858955223080",
  "1011758715713","858305376215","1038678335432","1037364133379","743259164195",
];

async function main() {
  const prisma = new PrismaClient();
  const cutoff = new Date(Date.now() - 90 * 60 * 1000); // last 90 minutes
  const jobs = await prisma.scrapeJob.findMany({
    where: {
      sourceUrl: { contains: "detail.1688.com/offer/" },
      createdAt: { gte: cutoff },
    },
    select: { id: true, sourceUrl: true, status: true, product: { select: { id: true, title: true } } },
  });
  const targets = jobs.filter((j) => {
    const m = j.sourceUrl.match(/\/offer\/(\d+)/);
    return m ? OFFER_IDS.includes(m[1]) : false;
  });
  console.log(`Matched ${targets.length} jobs to delete (out of ${jobs.length} recent jobs).`);
  if (targets.length === 0) { await prisma.$disconnect(); return; }
  for (const j of targets) {
    console.log(`  job=${j.id} status=${j.status} product=${j.product?.id ?? "(none)"} ${j.product?.title?.slice(0, 50) ?? ""}`);
  }

  // Delete products first (cascade removes variants + images), then the jobs.
  const productIds = targets.map((j) => j.product?.id).filter((id): id is string => !!id);
  const jobIds = targets.map((j) => j.id);

  const deletedProducts = productIds.length > 0
    ? await prisma.product.deleteMany({ where: { id: { in: productIds } } })
    : { count: 0 };
  const deletedJobs = await prisma.scrapeJob.deleteMany({ where: { id: { in: jobIds } } });
  console.log(`\nDeleted ${deletedProducts.count} products, ${deletedJobs.count} jobs.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
