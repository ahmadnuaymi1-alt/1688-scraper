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
  // Get a failed job's logs
  const failedJob = await prisma.scrapeJob.findFirst({
    where: { status: "failed", errorMessage: { contains: "Bright Data returned suspiciously short" } },
    select: { id: true, sourceUrl: true, logs: true },
  });
  
  if (!failedJob) {
    console.log("No failed job found");
    process.exit(0);
  }
  
  console.log(`Job: ${failedJob.id}`);
  console.log(`URL: ${failedJob.sourceUrl}`);
  console.log(`Logs (${failedJob.logs.length} entries):`);
  for (const log of failedJob.logs) {
    console.log(`  [${log.level.toUpperCase()}] ${log.message}`);
  }
  
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
