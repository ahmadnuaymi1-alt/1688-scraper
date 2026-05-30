/**
 * Re-run the title rule on every product (or on a specific subset). Logs each
 * old → new title as it lands. Uses bounded concurrency so OpenAI doesn't get
 * a 60-wide burst.
 *
 *   npx tsx scripts/_rerun-titles.ts                # all products, concurrency 4
 *   npx tsx scripts/_rerun-titles.ts --dry-run      # list what WOULD be re-run
 *   npx tsx scripts/_rerun-titles.ts --limit 5      # first 5 only (newest)
 *   npx tsx scripts/_rerun-titles.ts --concurrency 2
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

function getArg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = Number(getArg("limit", "0")) || 0;
  const concurrency = Math.max(1, Number(getArg("concurrency", "4")) || 4);

  const prisma = new PrismaClient();
  const { applyRulesByCategory } = await import("../src/services/rule.service");

  const products = await prisma.product.findMany({
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit > 0 ? limit : undefined,
  });
  process.stdout.write(`Re-running title rule on ${products.length} product(s) at concurrency ${concurrency}\n\n`);

  if (dryRun) {
    for (const p of products) {
      process.stdout.write(`would re-run: ${p.id}  "${p.title.slice(0, 70)}"\n`);
    }
    process.stdout.write(`\n(dry-run — no rule calls made)\n`);
    await prisma.$disconnect();
    return;
  }

  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  let done = 0;
  const failures: Array<{ id: string; err: string }> = [];

  await parallelWithLimit(products, concurrency, async (p) => {
    const old = p.title;
    const t0 = Date.now();
    try {
      await applyRulesByCategory(p.id, "title", DEFAULT_SCRAPE_OPTIONS);
      const fresh = await prisma.product.findUnique({
        where: { id: p.id },
        select: { title: true },
      });
      const next = fresh?.title ?? "";
      done++;
      const tag = String(done).padStart(2, " ");
      process.stdout.write(`[${tag}/${products.length}] ${p.id}  (${Date.now() - t0}ms)\n`);
      process.stdout.write(`        old: ${old.slice(0, 90)}\n`);
      process.stdout.write(`        new: ${next.slice(0, 90)}\n`);
    } catch (err) {
      done++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ id: p.id, err: msg });
      process.stdout.write(`[${done}/${products.length}] ${p.id}  ✗ ${msg}\n`);
    }
  });

  process.stdout.write(`\nDone. ${products.length - failures.length}/${products.length} succeeded.\n`);
  if (failures.length > 0) {
    process.stdout.write(`Failures:\n`);
    for (const f of failures) {
      process.stdout.write(`  ${f.id}: ${f.err}\n`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
