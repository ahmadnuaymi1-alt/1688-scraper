/**
 * Scrape one 1688 URL using a saved ScrapeOptionPreset, optionally overriding
 * auto-curation. Enqueues a job with the preset's options, drives the existing
 * job processor (POST /api/jobs/process — no auth) through Phase 1 + Phase 2,
 * and polls until the job is ready/failed.
 *
 *   npx tsx scripts/_scrape-with-preset.ts <url> "<presetName>" [--no-curate]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";
import { enqueueScrapeJob } from "../src/lib/jobs/queue";
import { ScrapeOptionsSchema } from "../src/types/scrape-options";

const URL_ARG = process.argv[2];
const PRESET_NAME = process.argv[3];
const noCurate = process.argv.includes("--no-curate");
const BASE = process.env.SCRAPE_BASE_URL || "http://localhost:3000";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!URL_ARG || !PRESET_NAME) {
    console.error('Usage: tsx scripts/_scrape-with-preset.ts <url> "<presetName>" [--no-curate]');
    process.exit(1);
  }
  const preset = await prisma.scrapeOptionPreset.findFirst({ where: { name: PRESET_NAME } });
  if (!preset) {
    console.error(`Preset "${PRESET_NAME}" not found.`);
    process.exit(1);
  }
  const baseOpts = JSON.parse(preset.options) as Record<string, unknown>;
  const merged = { ...baseOpts, ...(noCurate ? { autoCurateVariants: false } : {}) };
  const options = ScrapeOptionsSchema.parse(merged);
  console.log(
    `Preset "${PRESET_NAME}" (user ${preset.userId}) | autoCurate=${options.autoCurateVariants} pricing=${options.suggestedPricing} status=${options.productStatus}`,
  );

  const jobId = await enqueueScrapeJob(URL_ARG, JSON.stringify(options), preset.userId ?? undefined);
  console.log(`Enqueued job ${jobId}\n  ${URL_ARG}`);

  const start = Date.now();
  const MAX_MS = 13 * 60_000;
  let lastStatus = "";
  while (Date.now() - start < MAX_MS) {
    try {
      await fetch(`${BASE}/api/jobs/process`, { method: "POST" });
    } catch (e) {
      console.warn(`  process call failed: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(4000);
    const job = await prisma.scrapeJob.findUnique({
      where: { id: jobId },
      select: { status: true, errorMessage: true, product: { select: { id: true, title: true } } },
    });
    if (!job) {
      console.error("job vanished");
      break;
    }
    if (job.status !== lastStatus) {
      console.log(`  [${Math.round((Date.now() - start) / 1000)}s] status=${job.status}`);
      lastStatus = job.status;
    }
    if (job.status === "ready") {
      console.log(`\nREADY → product ${job.product?.id}`);
      console.log(`  ${job.product?.title?.slice(0, 70)}`);
      console.log(`  Review: ${BASE}/review/${job.product?.id}`);
      break;
    }
    if (job.status === "failed") {
      console.error(`\nFAILED: ${job.errorMessage}`);
      break;
    }
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
