/**
 * Re-run the title rule on a specific list of product IDs (passed as CLI args).
 * Useful for the small set of products where the first batch had the LLM
 * echo the input rather than rewrite it.
 *
 *   npx tsx scripts/_rerun-title-ids.ts <id1> <id2> ...
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

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    process.stderr.write(`Usage: npx tsx scripts/_rerun-title-ids.ts <id> [<id> ...]\n`);
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const { applyRulesByCategory } = await import("../src/services/rule.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  for (const id of ids) {
    const before = await prisma.product.findUnique({ where: { id }, select: { title: true } });
    if (!before) { process.stdout.write(`${id}: NOT FOUND\n`); continue; }
    try {
      await applyRulesByCategory(id, "title", DEFAULT_SCRAPE_OPTIONS);
      const after = await prisma.product.findUnique({ where: { id }, select: { title: true } });
      process.stdout.write(`${id}\n`);
      process.stdout.write(`  old: ${before.title}\n`);
      process.stdout.write(`  new: ${after?.title ?? ""}\n\n`);
    } catch (err) {
      process.stdout.write(`${id}: ✗ ${err instanceof Error ? err.message : err}\n`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
