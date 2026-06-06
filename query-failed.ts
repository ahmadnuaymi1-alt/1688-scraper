import fs from "node:fs";
import path from "node:path";

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

import { prisma } from "@/lib/db";

async function main() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Summary by status
  const byStatus = await prisma.scrapeJob.groupBy({
    by: ["status"],
    where: { createdAt: { gte: oneDayAgo } },
    _count: true,
  });
  console.log("\n=== Last 24 hours, grouped by status ===");
  for (const row of byStatus) {
    console.log(`${row.status}: ${row._count}`);
  }
  
  // Failed jobs with Bright Data error
  const failed = await prisma.scrapeJob.findMany({
    where: {
      status: "failed",
      createdAt: { gte: oneDayAgo },
      errorMessage: { contains: "Bright Data returned suspiciously short body" },
    },
    select: { sourceUrl: true, errorMessage: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  
  console.log(`\n=== Failed with "Bright Data 0 bytes" error (last 24h) ===`);
  console.log(`Total: ${failed.length}`);
  for (const job of failed) {
    const offerId = job.sourceUrl.match(/\/offer\/(\d+)\./)?.[1] || "?";
    const time = job.createdAt.toISOString();
    console.log(`${time} | offer=${offerId} | URL=${job.sourceUrl}`);
  }
  
  // Successful jobs
  const successful = await prisma.scrapeJob.findMany({
    where: {
      status: "ready",
      createdAt: { gte: oneDayAgo },
    },
    select: { sourceUrl: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  
  console.log(`\n=== Successful jobs (top 15 from last 24h) ===`);
  for (const job of successful) {
    const offerId = job.sourceUrl.match(/\/offer\/(\d+)\./)?.[1] || "?";
    const time = job.createdAt.toISOString();
    console.log(`${time} | offer=${offerId}`);
  }
  
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
