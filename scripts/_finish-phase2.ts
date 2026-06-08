/**
 * Finish Phase 2 (handleRulesJob) for a fixed list of job IDs that are stuck in
 * applying_rules. Sequential (concurrency 1) to stay well under the Anthropic
 * rate limit. Phase 1 already produced the product, so this only re-runs
 * enrichment/audit and marks the job ready.
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

const JOB_IDS = [
  "cmpwsnya2001lw28c33a2qgyb", // 1050020297073
  "cmpwsnxnr0019w28cgl1uoqau", // 913699979882
];

async function main() {
  const { handleRulesJob } = await import("../src/services/scraper.service");
  const prisma = new PrismaClient();

  for (const id of JOB_IDS) {
    const before = await prisma.scrapeJob.findUnique({
      where: { id },
      select: { status: true, sourceUrl: true },
    });
    if (!before) { console.log(`SKIP ${id} — not found`); continue; }
    console.log(`\nFinishing Phase 2: ${id} (${before.status}) ${before.sourceUrl}`);
    const t0 = Date.now();
    try {
      await handleRulesJob(id);
      // Clear any stale errorMessage left from the original 502 failure.
      await prisma.scrapeJob.update({ where: { id }, data: { errorMessage: null } });
      const after = await prisma.scrapeJob.findUnique({ where: { id }, select: { status: true } });
      console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${after?.status}`);
    } catch (e) {
      console.error(`  FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
