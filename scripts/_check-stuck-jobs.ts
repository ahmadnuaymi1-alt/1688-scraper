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

const prisma = new PrismaClient();
(async () => {
  const jobs = await prisma.scrapeJob.findMany({
    where: { status: { in: ["queued", "scraping", "applying_rules"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      sourceUrl: true,
      status: true,
      startedAt: true,
      createdAt: true,
      errorMessage: true,
    },
  });
  console.log(`Active jobs: ${jobs.length}\n`);
  for (const j of jobs) {
    const age = Math.round((Date.now() - j.createdAt.getTime()) / 1000);
    const inflight = j.startedAt
      ? Math.round((Date.now() - j.startedAt.getTime()) / 1000)
      : null;
    console.log(
      `${j.status.padEnd(15)}  created ${age}s ago  startedAt ${inflight !== null ? `${inflight}s ago` : "—"}  ${j.sourceUrl.slice(-60)}`,
    );
  }
  await prisma.$disconnect();
})();
