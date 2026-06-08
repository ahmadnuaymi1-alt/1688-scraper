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

const JOB_ID = "cmq3nshu10001w2hsvbdakco8";

(async () => {
  const p = new PrismaClient();
  try {
    const job = await p.scrapeJob.findUnique({
      where: { id: JOB_ID },
      select: { id: true, status: true, errorMessage: true, sourceUrl: true, createdAt: true, updatedAt: true },
    });
    console.log("ScrapeJob:", JSON.stringify(job, null, 2));

    const logs = await p.jobLog.findMany({
      where: { scrapeJobId: JOB_ID },
      orderBy: { createdAt: "asc" },
      select: { level: true, message: true, createdAt: true },
    });
    console.log(`\nJobLog (${logs.length} entries):`);
    for (const l of logs) {
      const ts = l.createdAt.toISOString().slice(11, 19);
      console.log(`  [${ts}] ${l.level.padEnd(6)} ${l.message.slice(0, 200)}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
