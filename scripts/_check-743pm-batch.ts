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
  // The user said they scraped at 7:43pm. Look at jobs created in the last 90 min.
  const cutoff = new Date(Date.now() - 90 * 60 * 1000);
  const jobs = await prisma.scrapeJob.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sourceUrl: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
    },
  });
  console.log(`${jobs.length} jobs created in last 90 minutes:\n`);
  const byStatus = new Map<string, number>();
  for (const j of jobs) {
    byStatus.set(j.status, (byStatus.get(j.status) ?? 0) + 1);
  }
  console.log("By status:");
  for (const [s, n] of byStatus) console.log(`  ${s}: ${n}`);
  console.log("");
  console.log("Failed jobs:");
  for (const j of jobs.filter((j) => j.status === "failed")) {
    console.log(`  ${j.id}  ${j.sourceUrl.slice(-50)}`);
    console.log(`    err: ${(j.errorMessage ?? "").slice(0, 150)}`);
  }
  await prisma.$disconnect();
})();
