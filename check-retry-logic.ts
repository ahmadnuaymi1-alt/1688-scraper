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

// This script reviews the retry logic in processor.ts and scraper.service.ts
// Key question: after a job fails (e.g., BrightDataError), can it be manually retried?

import { prisma } from "@/lib/db";

async function main() {
  // Check if there's a way to manually retry a failed job
  // by resetting its status to "queued"
  
  const failedJobId = (await prisma.scrapeJob.findFirst({
    where: { status: "failed", errorMessage: { contains: "Bright Data returned suspiciously short" } },
    select: { id: true, sourceUrl: true },
  }))?.id;
  
  if (!failedJobId) {
    console.log("No failed job with BD error found");
    process.exit(0);
  }
  
  console.log(`Found failed job: ${failedJobId}`);
  console.log(`To retry, would run: UPDATE ScrapeJob SET status='queued', startedAt=null WHERE id='${failedJobId}'`);
  console.log("\nCurrent findings:");
  console.log("1. The processor.ts has NO outer-retry loop");
  console.log("2. When scraper.service.ts calls fetchViaBrightData(), it throws immediately on failure");
  console.log("3. The processor catches the exception and calls failScrapeJob() → permanent failure");
  console.log("4. The Bright Data client internally retries 5 times with exponential backoff (2s → 5s → 10s → 20s)");
  console.log("5. If all 5 BD attempts exhaust, the job is marked failed with no job-level retry");
  console.log("\nIMPACT: Transient BD failures (like the one we just saw succeed on retry) become permanent job failures.");
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
