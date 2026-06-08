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

const JOB_ID = "cmq3nshu10001w2hsvbdakco8";

async function main() {
  const { handleRulesJob } = await import("../src/services/scraper.service");
  const prisma = new PrismaClient();
  const before = await prisma.scrapeJob.findUnique({ where: { id: JOB_ID }, select: { status: true, sourceUrl: true } });
  if (!before) { console.log("NOT FOUND"); process.exit(1); }
  console.log(`Finishing Phase 2: ${JOB_ID} (${before.status}) ${before.sourceUrl}`);
  const t0 = Date.now();
  await handleRulesJob(JOB_ID);
  await prisma.scrapeJob.update({ where: { id: JOB_ID }, data: { errorMessage: null } });
  const after = await prisma.scrapeJob.findUnique({ where: { id: JOB_ID }, select: { status: true } });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${after?.status}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
