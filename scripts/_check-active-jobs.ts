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
  const ACTIVE_STATUSES = ["pending", "queued", "extracting", "auditing", "applying_rules", "running"];
  const jobs = await p.scrapeJob.findMany({
    where: { status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, status: true, sourceUrl: true, createdAt: true, product: { select: { title: true } } },
  });
  console.log(`Active jobs (status in ${ACTIVE_STATUSES.join(",")}): ${jobs.length}`);
  for (const j of jobs.slice(0, 30)) {
    const url = j.sourceUrl.match(/offer\/(\d+)/)?.[1] ?? j.sourceUrl;
    const ageMin = Math.round((Date.now() - new Date(j.createdAt).getTime()) / 60000);
    console.log(`  ${j.status.padEnd(15)} ${ageMin}m old  offer=${url}  ${(j.product?.title ?? "").slice(0, 50)}`);
  }
  await p.$disconnect();
})();
