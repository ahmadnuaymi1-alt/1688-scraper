/**
 * Rescrape all currently-failed scrape jobs IN PLACE (reusing the same job rows
 * so the imports UI shows them transition failed → ready rather than creating
 * duplicates). For each failed job: reset its state, then run Phase 1
 * (handleScrapeJob) + Phase 2 (handleRulesJob) directly. Fans out across all
 * failed jobs in parallel.
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

async function main() {
  const { handleScrapeJob, handleRulesJob } = await import("../src/services/scraper.service");
  const prisma = new PrismaClient();

  const failed = await prisma.scrapeJob.findMany({
    where: { status: "failed" },
    orderBy: { createdAt: "desc" },
    select: { id: true, sourceUrl: true, errorMessage: true },
  });

  if (failed.length === 0) {
    console.log("No failed jobs to rescrape.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Rescraping ${failed.length} failed job(s) in parallel:\n`);
  for (const j of failed) {
    console.log(`  job=${j.id}  ${j.sourceUrl}`);
    console.log(`    was: ${(j.errorMessage ?? "").split("\n")[0].slice(0, 90)}`);
  }
  console.log("");

  const t0 = Date.now();
  const results = await Promise.all(
    failed.map(async (j) => {
      // Clean the row so success overwrites the stale 502 error.
      await prisma.scrapeJob.update({
        where: { id: j.id },
        data: { status: "queued", errorMessage: null, startedAt: null, completedAt: null },
      });
      try {
        await handleScrapeJob(j.id, j.sourceUrl); // Phase 1 → applying_rules
        await handleRulesJob(j.id); // Phase 2 → ready
      } catch (e) {
        return { id: j.id, url: j.sourceUrl, error: e instanceof Error ? e.message : String(e) };
      }
      return { id: j.id, url: j.sourceUrl, error: null as string | null };
    }),
  );

  // Read back final state.
  const finals = await prisma.scrapeJob.findMany({
    where: { id: { in: failed.map((f) => f.id) } },
    select: {
      id: true,
      sourceUrl: true,
      status: true,
      errorMessage: true,
      product: { select: { id: true, title: true, _count: { select: { variants: true, images: true } } } },
    },
  });

  console.log(`\n========== RESCRAPE COMPLETE (${((Date.now() - t0) / 1000).toFixed(1)}s) ==========`);
  for (const f of finals) {
    const r = results.find((x) => x.id === f.id);
    const ok = f.status === "ready" && !f.errorMessage;
    console.log(`${ok ? "OK  " : "FAIL"} ${f.status.padEnd(14)} job=${f.id}`);
    console.log(`     url: ${f.sourceUrl}`);
    if (f.product) {
      console.log(`     product=${f.product.id} vars=${f.product._count.variants} imgs=${f.product._count.images} :: ${(f.product.title ?? "").slice(0, 60)}`);
      console.log(`     review: http://localhost:3000/review/${f.product.id}`);
    }
    if (f.errorMessage) console.log(`     err: ${f.errorMessage.split("\n")[0].slice(0, 120)}`);
    if (r?.error && !f.errorMessage) console.log(`     threw: ${r.error.split("\n")[0].slice(0, 120)}`);
  }
  const okCount = finals.filter((f) => f.status === "ready" && !f.errorMessage).length;
  console.log(`\n${okCount}/${finals.length} now ready`);

  await prisma.$disconnect();
  process.exit(okCount === finals.length ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
