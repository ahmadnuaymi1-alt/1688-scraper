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
  
  // Failed with short body
  const failed = await prisma.scrapeJob.findMany({
    where: {
      status: "failed",
      createdAt: { gte: oneDayAgo },
      errorMessage: { contains: "Bright Data returned suspiciously short body" },
    },
    select: { sourceUrl: true, createdAt: true, errorMessage: true },
  });
  
  // Successful
  const successful = await prisma.scrapeJob.findMany({
    where: {
      status: "ready",
      createdAt: { gte: oneDayAgo },
    },
    select: { sourceUrl: true, createdAt: true },
  });
  
  const parseOfferId = (url: string): number | null => {
    const m = url.match(/\/offer\/(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
  };
  
  const failedOfferIds = failed.map(j => parseOfferId(j.sourceUrl)).filter((id): id is number => id !== null).sort((a, b) => a - b);
  const successOfferIds = successful.map(j => parseOfferId(j.sourceUrl)).filter((id): id is number => id !== null).sort((a, b) => a - b);
  
  console.log("\n=== FAILED OFFER IDs (sorted) ===");
  console.log(failedOfferIds.join(", "));
  console.log(`Range: ${Math.min(...failedOfferIds)} - ${Math.max(...failedOfferIds)}`);
  
  console.log("\n=== SUCCESSFUL OFFER IDs (sorted) ===");
  console.log(successOfferIds.join(", "));
  console.log(`Range: ${Math.min(...successOfferIds)} - ${Math.max(...successOfferIds)}`);
  
  // Time analysis
  console.log("\n=== TIME ANALYSIS ===");
  const failedTimes = failed.map(j => j.createdAt.getHours() + ":" + String(j.createdAt.getMinutes()).padStart(2, "0"));
  const successTimes = successful.map(j => j.createdAt.getHours() + ":" + String(j.createdAt.getMinutes()).padStart(2, "0"));
  console.log(`Failed times: ${[...new Set(failedTimes)].join(", ")}`);
  console.log(`Success times: ${[...new Set(successTimes)].join(", ")}`);
  
  // Error message detail
  console.log("\n=== ERROR MESSAGES ===");
  for (const job of failed) {
    const offerId = parseOfferId(job.sourceUrl);
    const bodyBytes = job.errorMessage?.match(/\((\d+) bytes\)/)?.[1] || "?";
    console.log(`Offer ${offerId}: body was ${bodyBytes} bytes`);
  }
  
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
