/**
 * Re-run the AI Phase-2 work that failed when Anthropic credits were depleted,
 * on the latest N scrapes. Per product, SEQUENTIALLY (rate-limit safe):
 *   1) re-translate any still-Chinese variant axes/values (Phase-1 step that failed)
 *   2) re-run handleRulesJob → description enrichment, audit, name cleanup,
 *      suggested pricing, featured-image re-derivation
 * Prints a per-product before/after summary and the total AI cost.
 *
 *   npx tsx scripts/_redo-failed-phase2.ts            # latest 10
 *   npx tsx scripts/_redo-failed-phase2.ts --take 5
 */
import fs from "node:fs";
import path from "node:path";
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, ""); if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const hasCjk = (s: string | null | undefined) => !!s && /[㐀-䶿一-鿿]/.test(s);

async function main() {
  const takeArg = process.argv.find((a) => a.startsWith("--take"));
  const take = takeArg ? parseInt(process.argv[process.argv.indexOf(takeArg) + 1] ?? "10", 10) : 10;

  const { prisma } = await import("../src/lib/db");
  const { handleRulesJob } = await import("../src/services/scraper.service");
  const { translateVariantsToEnglish } = await import("../src/services/variant-translator.service");
  const { resetUsage, formatUsageSummary, getUsageSummary } = await import("../src/lib/ai/usage-tracker");
  resetUsage();

  const jobs = await prisma.scrapeJob.findMany({
    where: { product: { isNot: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, product: { select: { id: true, title: true, optionNames: true } } },
  });

  console.log(`Redoing Phase 2 for ${jobs.length} product(s), sequentially.\n`);
  const t0 = Date.now();

  for (let n = 0; n < jobs.length; n++) {
    const job = jobs[n];
    const p = job.product!;
    const tag = `[${n + 1}/${jobs.length}] ${p.id}`;
    try {
      const beforeVariants = await prisma.variant.findMany({
        where: { productId: p.id }, orderBy: { position: "asc" },
        select: { id: true, position: true, option1: true, option2: true, option3: true, supplierLabel1: true, supplierLabel2: true, supplierLabel3: true },
      });
      const beforeDescLen = (await prisma.product.findUnique({ where: { id: p.id }, select: { descriptionHtml: true } }))?.descriptionHtml?.length ?? 0;
      const sample0 = beforeVariants[0]?.option1 ?? null;

      // 1) Re-translate (no-ops if nothing Chinese).
      const anyChinese = beforeVariants.some((v) => hasCjk(v.option1) || hasCjk(v.option2) || hasCjk(v.option3));
      if (anyChinese) {
        const optionNames: string[] = (() => { try { const x = JSON.parse(p.optionNames ?? "[]"); return Array.isArray(x) ? x : []; } catch { return []; } })();
        const scraped = {
          title: p.title ?? "",
          optionNames,
          variants: beforeVariants.map((v) => ({
            option1: v.option1 ?? undefined, option2: v.option2 ?? undefined, option3: v.option3 ?? undefined,
            supplierLabel1: v.supplierLabel1 ?? undefined, supplierLabel2: v.supplierLabel2 ?? undefined, supplierLabel3: v.supplierLabel3 ?? undefined,
          })),
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await translateVariantsToEnglish(scraped as any);
        for (let i = 0; i < beforeVariants.length; i++) {
          const sv = scraped.variants[i]; const db = beforeVariants[i];
          const changed = sv.option1 !== (db.option1 ?? undefined) || sv.option2 !== (db.option2 ?? undefined) || sv.option3 !== (db.option3 ?? undefined);
          if (!changed) continue;
          await prisma.variant.update({ where: { id: db.id }, data: {
            option1: sv.option1 ?? null, option2: sv.option2 ?? null, option3: sv.option3 ?? null,
            title: [sv.option1, sv.option2, sv.option3].filter(Boolean).join(" / "),
            supplierLabel1: sv.supplierLabel1 ?? db.supplierLabel1, supplierLabel2: sv.supplierLabel2 ?? db.supplierLabel2, supplierLabel3: sv.supplierLabel3 ?? db.supplierLabel3,
          } });
        }
        if (JSON.stringify(scraped.optionNames) !== (p.optionNames ?? "[]")) {
          await prisma.product.update({ where: { id: p.id }, data: { optionNames: JSON.stringify(scraped.optionNames) } });
        }
      }

      // 2) Re-run Phase 2.
      await handleRulesJob(job.id);

      const after = await prisma.product.findUnique({ where: { id: p.id }, select: { descriptionHtml: true, variants: { where: { isHidden: false }, orderBy: { position: "asc" }, take: 1, select: { option1: true } } } });
      const afterDescLen = after?.descriptionHtml?.length ?? 0;
      const spent = getUsageSummary().totalCostUSD;
      console.log(`${tag} OK  desc ${beforeDescLen}b→${afterDescLen}b  v0 ${JSON.stringify(sample0)}→${JSON.stringify(after?.variants[0]?.option1 ?? null)}  (cumulative $${spent.toFixed(3)})`);
    } catch (err) {
      console.error(`${tag} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nWall time: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  console.log(formatUsageSummary());
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
