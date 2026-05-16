/**
 * Job queue for the 1688 scraper pipeline.
 *
 * State machine (one mode, no orchestrator branching):
 *   queued → scraping → applying_rules → ready
 *                                     ↘ failed
 *
 * Atomic locking is via `updateMany` with a status+startedAt guard so two
 * pollers can never both claim the same row. recoverStuckJobs() resets any
 * non-terminal row whose `startedAt` is older than 15 minutes (matches the
 * legacy rationale: vision-heavy 1688 descriptions can legitimately take 5–10
 * minutes during Phase 2).
 */

import { prisma } from "@/lib/db";

/** Status values written into ScrapeJob.status. */
export type ScrapeJobStatus = "queued" | "scraping" | "applying_rules" | "ready" | "failed";

/** 15 minutes (matches legacy). */
const STUCK_CUTOFF_MS = 15 * 60_000;
/** 12 minutes (Phase 2 lock — Claude OCR / structuring / image rule fan-out can run long). */
const RULES_LOCK_MS = 12 * 60_000;

/** Enqueue a scrape job by creating a ScrapeJob row in `queued` state. */
export async function enqueueScrapeJob(
  sourceUrl: string,
  options?: string,
  userId?: string,
): Promise<string> {
  const job = await prisma.scrapeJob.create({
    data: {
      sourceUrl,
      status: "queued",
      options: options ?? null,
      userId: userId ?? null,
    },
  });
  return job.id;
}

/**
 * Reset non-terminal rows whose `startedAt` is older than 15 minutes so they
 * become eligible for re-dispatch. Returns the count of rows touched.
 *
 *   scraping  → status="queued", startedAt=null  (rerun Phase 1 from scratch)
 *   applying_rules → startedAt=null              (let another poller relock)
 */
export async function recoverStuckJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_CUTOFF_MS);

  const scrapingResult = await prisma.scrapeJob.updateMany({
    where: { status: "scraping", startedAt: { lt: cutoff } },
    data: { status: "queued", startedAt: null },
  });

  const rulesResult = await prisma.scrapeJob.updateMany({
    where: { status: "applying_rules", startedAt: { lt: cutoff } },
    data: { startedAt: null },
  });

  return scrapingResult.count + rulesResult.count;
}

/**
 * Dequeue the oldest queued scrape job (FIFO) and atomically flip it to
 * `scraping`. Returns null when there is no eligible row OR when another
 * poller won the race to lock the same row.
 */
export async function dequeueScrapeJob(): Promise<{ id: string; sourceUrl: string } | null> {
  const job = await prisma.scrapeJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;

  const updated = await prisma.scrapeJob.updateMany({
    where: { id: job.id, status: "queued" },
    data: { status: "scraping", startedAt: new Date() },
  });
  if (updated.count === 0) return null;

  return { id: job.id, sourceUrl: job.sourceUrl };
}

/**
 * Dequeue the oldest applying_rules job whose lock has expired (or never
 * acquired). The updateMany re-checks the lock condition so two concurrent
 * dequeues cannot both succeed.
 */
export async function dequeueRulesJob(): Promise<{ id: string } | null> {
  const cutoff = new Date(Date.now() - RULES_LOCK_MS);

  const job = await prisma.scrapeJob.findFirst({
    where: {
      status: "applying_rules",
      OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;

  const updated = await prisma.scrapeJob.updateMany({
    where: {
      id: job.id,
      status: "applying_rules",
      OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }],
    },
    data: { startedAt: new Date() },
  });
  if (updated.count === 0) return null;

  return { id: job.id };
}

/**
 * Mark Phase 1 complete and transition the job to `applying_rules`. We clear
 * `startedAt` so the next poller can immediately pick up Phase 2 without
 * waiting for the 12-minute lock to expire.
 */
export async function markApplyingRules(jobId: string): Promise<void> {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: "applying_rules" satisfies ScrapeJobStatus,
      startedAt: null,
    },
  });
}

/** Mark a job ready (Phase 2 complete). */
export async function completeScrapeJob(jobId: string): Promise<void> {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: "ready" satisfies ScrapeJobStatus,
      completedAt: new Date(),
    },
  });
}

/** Mark a job failed and persist the error message. */
export async function failScrapeJob(jobId: string, errorMessage: string): Promise<void> {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: "failed" satisfies ScrapeJobStatus,
      errorMessage,
      completedAt: new Date(),
    },
  });
}

/** Append a log line for a scrape job. */
export async function addJobLog(
  jobId: string,
  level: "info" | "warn" | "error",
  message: string,
): Promise<void> {
  await prisma.jobLog.create({
    data: {
      scrapeJobId: jobId,
      level,
      message,
    },
  });
}
