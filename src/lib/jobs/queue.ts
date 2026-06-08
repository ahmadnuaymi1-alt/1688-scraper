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

/**
 * Max number of Phase 2 (applying_rules) jobs allowed to be actively
 * processed at once across all concurrent pollers. Anthropic's free-tier
 * rate cap is 50 RPM / 50K TPM; each Phase 2 job fires ~6-9 Claude calls
 * across audit / curation / pricing, so >3 concurrent jobs typically blow
 * the org rate cap and force every job into long 429 retry waits.
 *
 * TOCTOU note: the count check + the row claim below are two separate
 * statements on Read Committed Postgres. Under N concurrent pollers, up
 * to N overshoot is possible (each poller sees count=cap-1 before any
 * claims). Acceptable in practice — typical poller count is 1-2 (browser
 * tabs on /imports), and Phase 2 jobs run minutes so a 1-job overshoot
 * self-corrects within one cycle. Revisit with a Postgres
 * FOR UPDATE SKIP LOCKED CTE if multi-pod / external cron pushes poller
 * count above 3.
 */
export const MAX_CONCURRENT_RULES = 3;

/**
 * Auto-retry config for Phase 1 transient failures (Bright Data flakes, etc.).
 * On a transient failure the processor flips the job back to `queued` with
 * `scheduledAt = now() + RETRY_DELAY_MS` and increments `retryCount`. Once
 * `retryCount` hits `MAX_AUTO_RETRIES`, the job is marked failed for real.
 * 10-minute delay × 2 retries is enough headroom for the observed BD outage
 * pattern (failures clustered in 2-second windows that clear within 30s).
 */
export const RETRY_DELAY_MS = 10 * 60_000;
export const MAX_AUTO_RETRIES = 2;

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
  // `scheduledAt` is set by the auto-retry path (rescheduleScrapeJob) to defer
  // a retry past a transient Bright Data outage window. A null `scheduledAt`
  // means "ready to run now" (the normal case for freshly-enqueued jobs).
  const now = new Date();
  const job = await prisma.scrapeJob.findFirst({
    where: {
      status: "queued",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!job) return null;

  const updated = await prisma.scrapeJob.updateMany({
    where: {
      id: job.id,
      status: "queued",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    data: { status: "scraping", startedAt: new Date() },
  });
  if (updated.count === 0) return null;

  return { id: job.id, sourceUrl: job.sourceUrl };
}

/**
 * Auto-retry a transient Phase 1 failure. Reads `retryCount`; if already at
 * or past `MAX_AUTO_RETRIES`, returns false (caller should call failScrapeJob
 * instead). Otherwise flips the job back to `queued` with `scheduledAt =
 * now() + RETRY_DELAY_MS`, increments `retryCount`, and clears the failure
 * state (`errorMessage`, `startedAt`, `completedAt`). The next dequeue cycle
 * after the scheduled time picks it up.
 */
export async function rescheduleScrapeJob(jobId: string): Promise<boolean> {
  const job = await prisma.scrapeJob.findUnique({
    where: { id: jobId },
    select: { retryCount: true },
  });
  if (!job) return false;
  if (job.retryCount >= MAX_AUTO_RETRIES) return false;
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: "queued",
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      scheduledAt: new Date(Date.now() + RETRY_DELAY_MS),
      retryCount: { increment: 1 },
    },
  });
  return true;
}

/**
 * Dequeue the oldest applying_rules job whose lock has expired (or never
 * acquired). The updateMany re-checks the lock condition so two concurrent
 * dequeues cannot both succeed.
 */
export async function dequeueRulesJob(): Promise<{ id: string } | null> {
  const cutoff = new Date(Date.now() - RULES_LOCK_MS);

  // Cap-check: count rows that are actively being processed RIGHT NOW
  // (status applying_rules AND startedAt set AND startedAt > cutoff —
  // past-lock rows are recoverable and don't count as "active"). If we're
  // at cap, defer this dequeue so in-flight jobs can finish before we
  // start new ones. See MAX_CONCURRENT_RULES comment above for the TOCTOU
  // tradeoff.
  const activeCount = await prisma.scrapeJob.count({
    where: {
      status: "applying_rules",
      AND: [
        { startedAt: { not: null } },
        { startedAt: { gt: cutoff } },
      ],
    },
  });
  if (activeCount >= MAX_CONCURRENT_RULES) {
    console.warn(
      `[queue] rules cap reached — active=${activeCount} cap=${MAX_CONCURRENT_RULES}, deferring`,
    );
    return null;
  }

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
