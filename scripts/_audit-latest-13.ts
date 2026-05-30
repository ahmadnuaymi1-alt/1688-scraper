/**
 * ONE-OFF: Run the post-scrape audit on the latest 13 scraped products.
 *
 * The audit auto-fires on new scrapes (Phase 2 in scraper.service.ts), but
 * products scraped BEFORE the audit landed need a manual pass — this script
 * is that pass. Sequential to be friendly to Claude rate limits.
 *
 * Safe to delete after running.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runPostScrapeAudit } from "../src/services/post-scrape-audit.service";

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

const TAKE = 13;

async function main() {
  const prisma = new PrismaClient();
  const jobs = await prisma.scrapeJob.findMany({
    where: { product: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take: TAKE,
    include: { product: { select: { id: true, title: true, createdAt: true } } },
  });
  const products = jobs
    .map((j) => j.product!)
    .filter((p): p is { id: string; title: string; createdAt: Date } => !!p);
  if (products.length === 0) {
    console.error("No products to audit.");
    process.exit(1);
  }
  console.log(`Auditing ${products.length} product(s) — latest ${TAKE} by scrape time:\n`);
  for (const p of products) {
    console.log(`  ${p.createdAt.toISOString()}  ${p.id}  ${p.title.slice(0, 70)}`);
  }
  console.log("");

  const t0 = Date.now();
  const summary: Array<{
    id: string;
    title: string;
    fixed: number;
    flagged: number;
    durationMs: number;
    perCheck: Array<{ check: string; checked: number; fixed: number; flagged: number; details: string[] }>;
  }> = [];
  for (const p of products) {
    console.log(`\n=== ${p.id} — ${p.title.slice(0, 60)} ===`);
    try {
      const r = await runPostScrapeAudit(p.id, null);
      summary.push({
        id: p.id,
        title: p.title,
        fixed: r.totalFixed,
        flagged: r.totalFlagged,
        durationMs: r.durationMs,
        perCheck: r.checks.map((c) => ({
          check: c.check,
          checked: c.checked,
          fixed: c.fixed,
          flagged: c.flagged,
          details: c.details,
        })),
      });
      console.log(`  Fixed=${r.totalFixed}  Flagged=${r.totalFlagged}  Duration=${r.durationMs}ms`);
      for (const c of r.checks) {
        if (c.fixed === 0 && c.flagged === 0) continue;
        console.log(`    [${c.check}] checked=${c.checked} fixed=${c.fixed} flagged=${c.flagged}`);
        for (const d of c.details) console.log(`      - ${d}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg}`);
      summary.push({ id: p.id, title: p.title, fixed: 0, flagged: 1, durationMs: 0, perCheck: [] });
    }
  }
  const totalSec = Math.round((Date.now() - t0) / 1000);

  console.log(`\n\n========== AUDIT SUMMARY ==========`);
  console.log(`Total wall: ${totalSec}s (${(totalSec / 60).toFixed(1)} min)`);
  console.log(`Products: ${summary.length}`);
  const totalFixed = summary.reduce((s, x) => s + x.fixed, 0);
  const totalFlagged = summary.reduce((s, x) => s + x.flagged, 0);
  console.log(`Total fixes: ${totalFixed}`);
  console.log(`Total flags: ${totalFlagged}`);
  console.log(`\nPer-product:`);
  for (const s of summary) {
    const flag = s.flagged > 0 ? ` ⚠️ ${s.flagged} flag(s)` : "";
    console.log(`  ${s.id}  fix=${s.fixed}${flag}  ${s.title.slice(0, 55)}`);
  }
  // Surface flagged-only items at the end (manual review queue).
  const needsManual = summary.filter((s) => s.flagged > 0);
  if (needsManual.length > 0) {
    console.log(`\n⚠️  Needs manual review:`);
    for (const s of needsManual) {
      console.log(`  ${s.id} — ${s.title.slice(0, 70)}`);
      for (const c of s.perCheck) {
        if (c.flagged === 0) continue;
        for (const d of c.details) {
          console.log(`    [${c.check}] ${d}`);
        }
      }
    }
  }
  console.log(`====================================`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
