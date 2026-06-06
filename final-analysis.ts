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
  
  const failed = await prisma.scrapeJob.findMany({
    where: {
      status: "failed",
      createdAt: { gte: oneDayAgo },
      errorMessage: { contains: "Bright Data returned suspiciously short body" },
    },
    select: { sourceUrl: true, createdAt: true, errorMessage: true },
  });
  
  const successful = await prisma.scrapeJob.findMany({
    where: { status: "ready", createdAt: { gte: oneDayAgo } },
    select: { sourceUrl: true, createdAt: true },
  });
  
  const parseOfferId = (url: string): number | null => {
    const m = url.match(/\/offer\/(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
  };
  
  const failedIds = failed.map(j => parseOfferId(j.sourceUrl)).filter((id): id is number => id !== null).sort((a, b) => a - b);
  const successIds = successful.map(j => parseOfferId(j.sourceUrl)).filter((id): id is number => id !== null).sort((a, b) => a - b);
  
  console.log("\n=== FAILED URLS ===");
  for (const j of failed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const id = parseOfferId(j.sourceUrl);
    console.log(`https://detail.1688.com/offer/${id}.html`);
  }
  
  console.log("\n=== SUMMARY ===");
  console.log(`Failed (0-byte): ${failed.length}`);
  console.log(`  Offer IDs: ${failedIds.join(", ")}`);
  console.log(`  Range: ${Math.min(...failedIds)} - ${Math.max(...failedIds)}`);
  console.log(`  Time cluster: 2026-06-04 08:44:23-08:44:25 UTC + 1 outlier 2026-06-03 15:11:58`);
  
  console.log(`\nSuccessful: ${successful.length}`);
  console.log(`  Offer IDs: ${successIds.join(", ")}`);
  console.log(`  Range: ${Math.min(...successIds)} - ${Math.max(...successIds)}`);
  
  // Check if there's overlap
  const overlap = failedIds.filter(id => successIds.includes(id));
  console.log(`\nOverlap (same offer in both): ${overlap.length > 0 ? overlap.join(", ") : "none"}`);
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
