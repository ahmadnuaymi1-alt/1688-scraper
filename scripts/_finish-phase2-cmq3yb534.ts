/**
 * Finish Phase 2 for job cmq3yb5340001w2q0vf5lay01
 * (product cmq3yck9q000jw2q03468fge7 — watch from 1688/946178666010)
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

const JOB_ID = "cmq3yb5340001w2q0vf5lay01";

async function main() {
  const { handleRulesJob } = await import("../src/services/scraper.service");
  const prisma = new PrismaClient();

  const before = await prisma.scrapeJob.findUnique({
    where: { id: JOB_ID },
    select: { status: true, sourceUrl: true },
  });
  if (!before) {
    console.log(`SKIP ${JOB_ID} — not found`);
    return;
  }
  console.log(`Finishing Phase 2: ${JOB_ID} (${before.status}) ${before.sourceUrl}`);
  const t0 = Date.now();
  try {
    await handleRulesJob(JOB_ID);
    await prisma.scrapeJob.update({
      where: { id: JOB_ID },
      data: { errorMessage: null },
    });
    const after = await prisma.scrapeJob.findUnique({
      where: { id: JOB_ID },
      select: { status: true },
    });
    console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${after?.status}`);
  } catch (e) {
    console.error(`  FAILED — ${e instanceof Error ? e.message : String(e)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
