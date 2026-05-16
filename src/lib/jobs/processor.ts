/**
 * Job processor — single polling cycle for the two-phase scrape pipeline.
 *
 * One `processNextJob()` call:
 *   1. recoverStuckJobs() — bump anything past the 15-minute deadline.
 *   2. up to 3 scrape pops (Phase 1).
 *   3. up to 3 rules pops (Phase 2).
 *
 * Handlers are registered at module load by `src/services/scraper.service.ts`.
 * If a handler throws we mark the job failed and continue — we never let one
 * bad job stop the cycle.
 */

import {
  dequeueScrapeJob,
  dequeueRulesJob,
  recoverStuckJobs,
  failScrapeJob,
} from "./queue";

type ScrapeHandler = (jobId: string, sourceUrl: string) => Promise<void>;
type RulesHandler = (jobId: string) => Promise<void>;

let scrapeHandler: ScrapeHandler | null = null;
let rulesHandler: RulesHandler | null = null;

export function registerScrapeHandler(handler: ScrapeHandler): void {
  scrapeHandler = handler;
}

export function registerRulesHandler(handler: RulesHandler): void {
  rulesHandler = handler;
}

/** Max jobs to drain per phase per cycle. */
const BATCH_LIMIT = 3;

export interface ProcessResult {
  processed: boolean;
}

/**
 * Run one cycle. Returns `{ processed: true }` if any work happened (job
 * recovered, scrape ran, rules ran). False when the queue was empty.
 */
export async function processNextJob(): Promise<ProcessResult> {
  let processed = false;

  // 0) Recover stuck rows so they can be re-picked this cycle.
  try {
    const recovered = await recoverStuckJobs();
    if (recovered > 0) {
      console.log(`[processor] Recovered ${recovered} stuck job(s)`);
      processed = true;
    }
  } catch (err) {
    console.error("[processor] recoverStuckJobs error:", err);
  }

  // 1) Phase 1 — scrape jobs.
  if (scrapeHandler) {
    for (let n = 0; n < BATCH_LIMIT; n++) {
      const job = await dequeueScrapeJob();
      if (!job) break;
      try {
        await scrapeHandler(job.id, job.sourceUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[processor] Scrape job ${job.id} handler error:`, err);
        try {
          await failScrapeJob(job.id, message);
        } catch (failErr) {
          console.error(`[processor] failScrapeJob also threw for ${job.id}:`, failErr);
        }
      }
      processed = true;
    }
  }

  // 2) Phase 2 — rules jobs.
  if (rulesHandler) {
    for (let n = 0; n < BATCH_LIMIT; n++) {
      const job = await dequeueRulesJob();
      if (!job) break;
      try {
        await rulesHandler(job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[processor] Rules job ${job.id} handler error:`, err);
        try {
          await failScrapeJob(job.id, message);
        } catch (failErr) {
          console.error(`[processor] failScrapeJob also threw for ${job.id}:`, failErr);
        }
      }
      processed = true;
    }
  }

  return { processed };
}
