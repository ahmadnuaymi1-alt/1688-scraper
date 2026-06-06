/**
 * Bulk-scrape a list of 1688 product URLs. Fans out at a sane concurrency cap
 * so the underlying audit (vision OCR + rule calls) doesn't blow Anthropic
 * rate limits. Waits for all jobs to reach a terminal state, then reports
 * success/failure per URL.
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

const URLS = [
  "https://detail.1688.com/offer/935997255860.html",
  "https://detail.1688.com/offer/1008724830559.html",
  "https://detail.1688.com/offer/797964575340.html",
  "https://detail.1688.com/offer/620374190700.html",
  "https://detail.1688.com/offer/867819198347.html",
  "https://detail.1688.com/offer/838088785314.html",
  "https://detail.1688.com/offer/887151234993.html",
  "https://detail.1688.com/offer/609075854364.html",
  "https://detail.1688.com/offer/891975968101.html",
  "https://detail.1688.com/offer/1050619801202.html",
  "https://detail.1688.com/offer/996926322946.html",
  "https://detail.1688.com/offer/657196961902.html",
  "https://detail.1688.com/offer/1013001591969.html",
  "https://detail.1688.com/offer/1007859812400.html",
  "https://detail.1688.com/offer/884173459922.html",
  "https://detail.1688.com/offer/1041633376980.html",
  "https://detail.1688.com/offer/651736472000.html",
  "https://detail.1688.com/offer/1036141567501.html",
  "https://detail.1688.com/offer/898685737610.html",
  "https://detail.1688.com/offer/858955223080.html",
  "https://detail.1688.com/offer/1011758715713.html",
  "https://detail.1688.com/offer/858305376215.html",
  "https://detail.1688.com/offer/1038678335432.html",
  "https://detail.1688.com/offer/1037364133379.html",
  "https://detail.1688.com/offer/743259164195.html",
];

const CONCURRENCY = 4;

interface ScrapeResult {
  url: string;
  jobId: string;
  status: string;
  productId: string | null;
  productTitle: string | null;
  variantCount: number;
  imageCount: number;
  startedAt: number;
  finishedAt: number;
  error: string | null;
}

async function scrapeOne(
  url: string,
  userId: string,
  optionsJson: string,
  handleScrapeJob: (id: string, src: string) => Promise<void>,
  prisma: PrismaClient,
  idx: number,
  total: number,
): Promise<ScrapeResult> {
  const startedAt = Date.now();
  const job = await prisma.scrapeJob.create({
    data: { userId, sourceUrl: url, status: "pending", options: optionsJson },
    select: { id: true },
  });
  console.log(`[${idx}/${total}] START job=${job.id} url=${url}`);
  let error: string | null = null;
  try {
    await handleScrapeJob(job.id, url);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[${idx}/${total}] THREW job=${job.id} — ${error}`);
  }
  const finishedAt = Date.now();
  const final = await prisma.scrapeJob.findUnique({
    where: { id: job.id },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      product: {
        select: {
          id: true,
          title: true,
          _count: { select: { variants: true, images: true } },
        },
      },
    },
  });
  const result: ScrapeResult = {
    url,
    jobId: job.id,
    status: final?.status ?? "unknown",
    productId: final?.product?.id ?? null,
    productTitle: final?.product?.title ?? null,
    variantCount: final?.product?._count.variants ?? 0,
    imageCount: final?.product?._count.images ?? 0,
    startedAt,
    finishedAt,
    error: error ?? final?.errorMessage ?? null,
  };
  const took = ((finishedAt - startedAt) / 1000).toFixed(1);
  const ok = result.status !== "failed" && !result.error;
  console.log(
    `[${idx}/${total}] ${ok ? "OK" : "FAIL"} ${took}s status=${result.status} ` +
      `vars=${result.variantCount} imgs=${result.imageCount} ${result.productTitle?.slice(0, 60) ?? ""}`,
  );
  return result;
}

async function main() {
  const { handleScrapeJob } = await import("../src/services/scraper.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  const recent = await prisma.scrapeJob.findFirst({
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  });
  if (!recent?.userId) {
    console.error("No existing ScrapeJob with userId — cannot resolve owner");
    process.exit(1);
  }
  const userId = recent.userId;
  const optionsJson = JSON.stringify(DEFAULT_SCRAPE_OPTIONS);
  console.log(
    `userId=${userId}  concurrency=${CONCURRENCY}  total=${URLS.length}\n`,
  );

  // Tiny in-process semaphore.
  let nextIdx = 0;
  const results: ScrapeResult[] = [];
  const t0 = Date.now();

  async function worker(workerIdx: number) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= URLS.length) return;
      const url = URLS[myIdx];
      const res = await scrapeOne(
        url,
        userId,
        optionsJson,
        handleScrapeJob,
        prisma,
        myIdx + 1,
        URLS.length,
      );
      results.push(res);
    }
  }
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i)),
  );

  const totalWall = ((Date.now() - t0) / 1000).toFixed(1);

  // Report.
  console.log(`\n========== BULK SCRAPE COMPLETE ==========`);
  console.log(`total wall time: ${totalWall}s`);
  const ok = results.filter((r) => !r.error && r.status !== "failed");
  const fail = results.filter((r) => r.error || r.status === "failed");
  console.log(`succeeded: ${ok.length}/${URLS.length}`);
  console.log(`failed:    ${fail.length}/${URLS.length}`);
  console.log(`\n--- SUCCESS ---`);
  for (const r of ok) {
    console.log(
      `  ${r.productId}  vars=${r.variantCount} imgs=${r.imageCount}  ` +
        `${r.productTitle?.slice(0, 70) ?? ""}\n    src: ${r.url}\n    review: http://localhost:3000/review/${r.productId}`,
    );
  }
  if (fail.length > 0) {
    console.log(`\n--- FAILURES ---`);
    for (const r of fail) {
      console.log(
        `  job=${r.jobId} status=${r.status} url=${r.url}\n    error: ${r.error}`,
      );
    }
  }
  await prisma.$disconnect();

  // Exit code: 0 if all OK, 2 if any failed (so caller can detect).
  process.exit(fail.length === 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
