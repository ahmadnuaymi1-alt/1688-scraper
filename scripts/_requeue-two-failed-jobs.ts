/**
 * Re-queue the two failed Bright-Data jobs from the 5/28 batch by flipping
 * their status back to "queued" so the existing poller re-runs Phase 1 +
 * Phase 2. Options (with suggestedPricing=true) are already on the row.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();
const URLS = [
  "https://detail.1688.com/offer/927740020672.html",
  "https://detail.1688.com/offer/894762015197.html",
];

(async () => {
  const jobs = await prisma.scrapeJob.findMany({
    where: { sourceUrl: { in: URLS }, status: "failed" },
    select: { id: true, sourceUrl: true, errorMessage: true },
    orderBy: { createdAt: "desc" },
  });
  if (jobs.length === 0) {
    console.log("No failed jobs found for those URLs. Nothing to re-queue.");
    await prisma.$disconnect();
    return;
  }
  // Re-queue the most recent failed row per URL.
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
  console.log(`\nDone. ${toRequeue.length} job(s) re-queued. Poller will pick them up on its next tick.`);
  await prisma.$disconnect();
})();
