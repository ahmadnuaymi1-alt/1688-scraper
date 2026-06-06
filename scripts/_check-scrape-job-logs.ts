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
  // Get the most recent scrape job that had suggestedPricing=true and look at its logs
  const PID = "cmpvdwok500frw2hk9nmld4k0"; // first of the 10
  const prod = await p.product.findUnique({ where: { id: PID }, select: { scrapeJob: { select: { id: true } } } });
  const jobId = prod?.scrapeJob?.id;
  if (!jobId) { console.log("no job"); process.exit(0); }
  console.log(`\nJob ${jobId} logs containing 'pricing' or 'Phase 2':\n`);
  const logs = await p.jobLog.findMany({
    where: { scrapeJobId: jobId },
    orderBy: { createdAt: "asc" },
    select: { level: true, message: true, createdAt: true },
  });
  for (const l of logs) {
    const ts = l.createdAt.toISOString().slice(11, 19);
    if (/pricing|Phase 2|rule|description|landed|claude|haiku|opus/i.test(l.message)) {
      console.log(`  [${ts}] ${l.level.toUpperCase().padEnd(5)} ${l.message}`);
    }
  }
  await p.$disconnect();
})();
