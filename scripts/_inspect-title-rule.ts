/**
 * Print the current title-category rule(s) so we can edit knowingly.
 *   npx tsx scripts/_inspect-title-rule.ts
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
  const all = await prisma.transformationRule.findMany({});
  process.stdout.write(`Total transformation rules: ${all.length}\n\n`);
  for (const r of all) {
    process.stdout.write(`===== ${r.id} | category=${r.category} | enabled=${r.enabled}\n`);
    process.stdout.write(`name: ${r.name ?? "(unnamed)"}\n`);
    process.stdout.write(`config:\n${r.config}\n`);
    process.stdout.write(`\n`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
