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
(async () => {
  const p = new PrismaClient();
  for (const pid of ["cmpwtdpb5005uw29gk3uft7k8", "cmpwtdkke003yw29gb0h63g82"]) {
    const prod = await p.product.findUnique({ where: { id: pid }, select: { title: true, scrapeJob: { select: { id: true, options: true } } } });
    const jobId = prod?.scrapeJob?.id;
    if (!jobId) { console.log(`${pid}: no job`); continue; }
    const opts = JSON.parse(prod?.scrapeJob?.options ?? "{}");
    console.log(`\n=== ${pid}  job=${jobId}  ===`);
    console.log(`title: ${prod?.title?.slice(0, 60)}`);
    console.log(`suggestedPricing flag: ${opts.suggestedPricing}`);
    const logs = await p.jobLog.findMany({
      where: { scrapeJobId: jobId },
      orderBy: { createdAt: "asc" },
      select: { level: true, message: true, createdAt: true },
    });
    console.log(`Pricing-related logs:`);
    for (const l of logs) {
      if (/pricing|Phase 2|landed|claude|haiku|opus|warn|error|recalculat|suggestPricing/i.test(l.message)) {
        const ts = l.createdAt.toISOString().slice(11, 19);
        console.log(`  [${ts}] ${l.level.toUpperCase().padEnd(5)} ${l.message.slice(0, 200)}`);
      }
    }
  }
  await p.$disconnect();
})();
