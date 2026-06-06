/**
 * List recent failed (and in-flight) scrape jobs with their URLs + error.
 * Read-only diagnostic.
 */
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

(async () => {
  const p = new PrismaClient();
  const jobs = await p.scrapeJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      sourceUrl: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });
  for (const j of jobs) {
    const ageMin = Math.round((Date.now() - new Date(j.createdAt).getTime()) / 60000);
    console.log(`${j.status.toUpperCase().padEnd(14)} ${ageMin}m ago  job=${j.id}`);
    console.log(`   url: ${j.sourceUrl}`);
    if (j.errorMessage) console.log(`   err: ${j.errorMessage.slice(0, 180)}`);
  }
  const counts = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nstatus counts (last 25):`, counts);
  await p.$disconnect();
})();
