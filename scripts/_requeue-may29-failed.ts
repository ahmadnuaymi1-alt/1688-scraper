/**
 * Re-queue the 3 Bright Data failures from the 5/29/2026 step-light batch
 * so the new 5-attempt exponential-backoff retry runs on them. Same flip
 * pattern as scripts/_requeue-two-failed-jobs.ts — clears errorMessage,
 * status → queued, lets the poller pick them up.
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

const prisma = new PrismaClient();
const URLS = [
  "https://detail.1688.com/offer/1047429367874.html",
  "https://detail.1688.com/offer/760540451066.html",
  "https://detail.1688.com/offer/853066431184.html",
];

(async () => {
  const jobs = await prisma.scrapeJob.findMany({
    where: { sourceUrl: { in: URLS }, status: "failed" },
    select: { id: true, sourceUrl: true, errorMessage: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (jobs.length === 0) {
    console.log("No failed jobs found for those URLs.");
    process.exit(0);
  }
  // Re-queue the most recent failed row per URL only.
  const seen = new Set<string>();
  const toRequeue: { id: string; sourceUrl: string }[] = [];
  for (const j of jobs) {
    if (seen.has(j.sourceUrl)) continue;
    seen.add(j.sourceUrl);
    toRequeue.push({ id: j.id, sourceUrl: j.sourceUrl });
  }
  for (const j of toRequeue) {
    await prisma.scrapeJob.update({
      where: { id: j.id },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null,
      },
    });
    console.log(`Re-queued ${j.id}  ${j.sourceUrl}`);
  }
  console.log(`\nDone. ${toRequeue.length} job(s) re-queued — poller will pick them up.`);
  await prisma.$disconnect();
})();
