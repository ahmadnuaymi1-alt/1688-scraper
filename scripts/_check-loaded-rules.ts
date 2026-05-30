/**
 * Print what loadRulesForCategory("title", product.userId) actually returns,
 * to verify the disabled short rule really isn't in the loaded set.
 *   npx tsx scripts/_check-loaded-rules.ts <productId>
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
  const id = process.argv[2];
  if (!id) { process.stderr.write("usage: <productId>\n"); process.exit(1); }
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({ where: { id }, select: { userId: true } });
  if (!product) { process.stderr.write("product missing\n"); process.exit(1); }
  process.stdout.write(`product.userId = ${product.userId}\n`);

  const rules = await prisma.transformationRule.findMany({
    where: {
      category: "title",
      enabled: true,
      ...(product.userId ? { userId: product.userId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  process.stdout.write(`loaded title rules: ${rules.length}\n`);
  for (const r of rules) {
    process.stdout.write(`  ${r.id} | enabled=${r.enabled} | userId=${r.userId} | name=${r.name}\n`);
    const cfg = JSON.parse(r.config);
    process.stdout.write(`    prompt head: ${cfg.prompt.slice(0, 120)}\n`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
