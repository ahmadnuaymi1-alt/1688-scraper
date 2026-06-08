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

(async () => {
  const url = process.argv[2];
  if (!url) { console.error("usage: tsx _scrape-1688-url.ts <url>"); process.exit(1); }

  const { handleScrapeJob } = await import("../src/services/scraper.service");
  const prisma = new PrismaClient();

  // Resolve owning user — pick the most recent ScrapeJob's userId.
  const recent = await prisma.scrapeJob.findFirst({
    orderBy: { createdAt: "desc" },
    select: { userId: true },
  });
  if (!recent) { console.error("No existing ScrapeJob → cannot resolve userId"); process.exit(1); }
  const userId = recent.userId;
  console.log(`Using userId=${userId}`);

  // Enqueue job. Reuse default ScrapeOptions (audit ON, descriptions ON, etc).
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const optionsJson = JSON.stringify(DEFAULT_SCRAPE_OPTIONS);
  const job = await prisma.scrapeJob.create({
    data: {
      userId,
      sourceUrl: url,
      status: "pending",
      options: optionsJson,
    },
    select: { id: true },
  });
  console.log(`Created ScrapeJob ${job.id} for ${url}`);
  console.log(`Calling handleScrapeJob() — this includes Phase 1 (extract) + Phase 2 (audit/enrich)...`);
  await handleScrapeJob(job.id, url);

  const after = await prisma.scrapeJob.findUnique({
    where: { id: job.id },
    select: { id: true, status: true, product: { select: { id: true, title: true } } },
  });
  console.log("FINAL:", JSON.stringify(after, null, 2));
  await prisma.$disconnect();
})();
