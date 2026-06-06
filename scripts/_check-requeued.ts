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
const IDS = [
  "cmpz91dry000rw29c7dkvipws",
  "cmpz91doj000pw29crr4z0fiy",
  "cmpz91dkv000nw29clchkr7lf",
  "cmpz91bv50003w29c2de7bv9b",
  "cmpz91ci50007w29cq9vzrgx3",
  "cmpy7fwzb01r7w2600jozedm1",
];
(async () => {
  const p = new PrismaClient();
  const jobs = await p.scrapeJob.findMany({
    where: { id: { in: IDS } },
    select: { id: true, sourceUrl: true, status: true, retryCount: true, errorMessage: true, scheduledAt: true, startedAt: true, completedAt: true },
  });
  console.log(`Re-queued job status:`);
  for (const j of jobs) {
    console.log(`  ${j.id}  status=${j.status}  retryCount=${j.retryCount}  scheduledAt=${j.scheduledAt?.toISOString() ?? "null"}  startedAt=${j.startedAt?.toISOString() ?? "null"}  completedAt=${j.completedAt?.toISOString() ?? "null"}  err=${j.errorMessage?.slice(0, 40) ?? "null"}`);
  }
  await p.$disconnect();
})();
