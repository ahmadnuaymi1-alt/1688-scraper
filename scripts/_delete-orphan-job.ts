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
  const jobId = process.argv[2];
  if (!jobId) { console.error("usage: tsx _delete-orphan-job.ts <jobId>"); process.exit(1); }
  const p = new PrismaClient();
  const j = await p.scrapeJob.findUnique({ where: { id: jobId }, select: { id: true, status: true, sourceUrl: true, product: { select: { id: true } } } });
  if (!j) { console.log("not found"); process.exit(0); }
  if (j.product) { console.log(`REFUSING: job ${jobId} has a linked product ${j.product.id} — aborting`); process.exit(1); }
  await p.scrapeJob.delete({ where: { id: jobId } });
  console.log(`deleted orphan job ${jobId} (status=${j.status}, url=${j.sourceUrl})`);
  await p.$disconnect();
})();
