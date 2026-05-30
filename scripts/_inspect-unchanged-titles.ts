/**
 * Inspect the three products whose titles came back unchanged after the
 * batch re-run, to understand why. Read-only.
 *   npx tsx scripts/_inspect-unchanged-titles.ts
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
  const prisma = new PrismaClient();
  const ids = [
    "cmp3vcmdh000zw2wggcjr65ft",
    "cmp2xivfj000nw2o4ggos1k5n",
    "cmp2vgh88000kw2s8fthhtwcw",
  ];
  for (const id of ids) {
    const r = await prisma.product.findUnique({ where: { id } });
    if (!r) { process.stdout.write(`${id}: NOT FOUND\n`); continue; }
    process.stdout.write(`===== ${id}\n`);
    process.stdout.write(`  title: ${r.title}\n`);
    process.stdout.write(`  vendor: ${r.vendor}\n`);
    process.stdout.write(`  productType: ${r.productType}\n`);
    process.stdout.write(`  optionNames: ${r.optionNames}\n`);
    process.stdout.write(`  productContext present: ${!!r.productContext}, length: ${(r.productContext || "").length}\n`);
    process.stdout.write(`  descriptionHtml length: ${(r.descriptionHtml || "").length}\n`);
    process.stdout.write(`\n`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
