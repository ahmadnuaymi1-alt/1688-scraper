/**
 * The split children have scrapeJobId=null (the parent's @unique job was deleted
 * with the parent), so they don't appear in the /imports list, which is built
 * from ScrapeJob.findMany. Give each child a synthetic "ready" ScrapeJob and
 * link it back, so they show up like normal imported products. Sequential.
 *
 *   npx tsx scripts/_relink-children-jobs.ts [--apply]
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

const APPLY = process.argv.includes("--apply");
const SOURCE_URL = "https://detail.1688.com/offer/1032476364160.html";
const CHILDREN = [
  "cmpxx12260001w2yspsqfr94i",
  "cmpxx130y000hw2ys0d5ikvsb",
  "cmpxx161q001pw2ysta9lvk0k",
  "cmpxx1854002lw2ys7vdeln6v",
  "cmpxx19xo003dw2ysoykzsyhg",
  "cmpxx1auc003tw2ysfupa6ih9",
];

(async () => {
  for (const cid of CHILDREN) {
    const child = await prisma.product.findUnique({
      where: { id: cid },
      select: { id: true, title: true, userId: true, scrapeJobId: true },
    });
    if (!child) { console.error(`! ${cid} missing`); continue; }
    if (child.scrapeJobId) { console.log(`= ${cid} already has job ${child.scrapeJobId} — skip`); continue; }
    console.log(`+ ${child.title?.split("—").pop()?.trim() ?? cid}  user=${child.userId}`);
    if (!APPLY) continue;
    const now = new Date();
    const job = await prisma.scrapeJob.create({
      data: {
        userId: child.userId,
        sourceUrl: SOURCE_URL,
        status: "ready",
        startedAt: now,
        completedAt: now,
      },
    });
    await prisma.product.update({ where: { id: cid }, data: { scrapeJobId: job.id } });
    console.log(`    ✓ linked job ${job.id}`);
  }
  if (!APPLY) console.log(`\n[dry-run] --apply to write`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
