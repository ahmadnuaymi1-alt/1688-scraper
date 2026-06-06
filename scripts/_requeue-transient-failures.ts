/**
 * One-off backfill: find recent ScrapeJob failures whose error message matches
 * a transient Bright Data pattern and re-queue them. Default is a dry run that
 * lists matches without touching the DB. Pass `--apply` to actually re-queue.
 *
 * The processor at src/lib/jobs/processor.ts polls the queue, so a flipped row
 * gets picked up on the next cycle (usually within 1-2 min in dev).
 *
 * The regex covers:
 *   - "suspiciously short body" — the current MIN_BODY_BYTES check
 *   - "Bright Data fetch error after" — the existing 5-attempt exhaustion
 *   - HTTP 5xx / 408 / 429 — transport-layer transient errors
 *   - timeout / ETIMEDOUT / ECONNRESET — network-level transient errors
 *
 * What it does NOT match: HTTP 400 / 403 / 404 (permanent), parse errors,
 * URL validation errors, or any other genuinely-permanent failure.
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const TRANSIENT_RE = /suspiciously short body|Bright Data fetch error after|HTTP 5\d\d|HTTP 408|HTTP 429|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i;
const WINDOW_HOURS = 24;

const APPLY = process.argv.includes("--apply");

(async () => {
  const prisma = new PrismaClient();
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60_000);
  const failed = await prisma.scrapeJob.findMany({
    where: { status: "failed", completedAt: { gte: since } },
    orderBy: { completedAt: "desc" },
    select: { id: true, sourceUrl: true, errorMessage: true, completedAt: true },
  });
  const matches = failed.filter((j) => j.errorMessage && TRANSIENT_RE.test(j.errorMessage));
  const permanents = failed.filter((j) => !j.errorMessage || !TRANSIENT_RE.test(j.errorMessage));

  console.log(`Looked at ${failed.length} failed ScrapeJob row(s) from the last ${WINDOW_HOURS}h.`);
  console.log(`  ${matches.length} match the transient pattern — will be re-queued.`);
  console.log(`  ${permanents.length} look permanent — leaving alone.`);
  console.log();
  if (matches.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Matches:`);
  for (const j of matches) {
    const ts = j.completedAt?.toISOString().slice(0, 19) ?? "?";
    const err = (j.errorMessage ?? "").slice(0, 100);
    console.log(`  ${ts}  ${j.id}  ${j.sourceUrl}\n    err: ${err}`);
  }

  if (!APPLY) {
    console.log(`\n[DRY RUN] Re-run with --apply to flip these ${matches.length} job(s) back to "queued".`);
    await prisma.$disconnect();
    return;
  }

  console.log(`\nApplying — flipping ${matches.length} job(s) back to queued...`);
  let ok = 0;
  let failedCount = 0;
  for (const j of matches) {
    try {
      await prisma.scrapeJob.update({
        where: { id: j.id },
        data: { status: "queued", errorMessage: null, startedAt: null, completedAt: null },
      });
      await prisma.jobLog.create({
        data: {
          scrapeJobId: j.id,
          level: "info",
          message: "Re-queued from failed state by _requeue-transient-failures.ts (transient BD pattern)",
        },
      });
      ok++;
    } catch (e) {
      console.log(`  ✗ ${j.id}: ${e instanceof Error ? e.message : e}`);
      failedCount++;
    }
  }
  console.log(`Done: ${ok} re-queued, ${failedCount} failed to update.`);
  console.log(`The processor poller should pick them up within ~1-2 min.`);
  await prisma.$disconnect();
})();
