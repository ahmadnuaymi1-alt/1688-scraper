/** Quick read-only inspect of product cmq3ybrqm000jw25g2h0dyzbp */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";
const JID = "cmq3yac8g0001w25gcap6v1la";

(async () => {
  const p = new PrismaClient();
  try {
    const job = await p.scrapeJob.findUnique({ where: { id: JID }, select: { status: true, errorMessage: true, updatedAt: true } });
    console.log("JOB:", JSON.stringify(job, null, 2));
    const product = await p.product.findUnique({
      where: { id: PID },
      select: { id: true, title: true, productType: true, optionNames: true, handle: true, tags: true },
    });
    console.log("PRODUCT:", JSON.stringify(product, null, 2));
    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { position: true, title: true, option1: true, option2: true, isHidden: true, price: true, supplierCost: true, featuredImageId: true },
    });
    console.log(`VARIANTS (${variants.length}):`);
    for (const v of variants) {
      console.log(`  #${String(v.position).padStart(2)} hidden=${v.isHidden ? "Y" : " "} o1="${v.option1 ?? ""}"  o2="${v.option2 ?? ""}"  price=${v.price ?? "?"}  cost=${v.supplierCost ?? "?"}  title="${v.title}"`);
    }
    const imgCount = await p.productImage.count({ where: { productId: PID } });
    console.log(`IMAGES: ${imgCount}`);
    const recentLogs = await p.jobLog.findMany({
      where: { scrapeJobId: JID },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { message: true, level: true, createdAt: true },
    });
    console.log("\nRECENT JOB LOGS (newest first):");
    for (const log of recentLogs) {
      console.log(`  [${log.level}] ${log.message}`);
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
