/**
 * Audit how many products have a non-null userId vs how many rules have
 * userId — to confirm the user-scoping mismatch that's making the title rule
 * silently no-op on certain products.
 *   npx tsx scripts/_audit-product-userid.ts
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
  const products = await prisma.product.findMany({ select: { id: true, userId: true, title: true } });
  const rules = await prisma.transformationRule.findMany({ select: { id: true, userId: true, category: true, enabled: true } });

  const productUserIds = [...new Set(products.map((p) => p.userId))];
  const ruleUserIds = [...new Set(rules.map((r) => r.userId))];
  process.stdout.write(`Products: ${products.length} | distinct userIds: ${productUserIds.length}\n`);
  for (const uid of productUserIds) {
    const count = products.filter((p) => p.userId === uid).length;
    process.stdout.write(`  product.userId=${uid}: ${count} products\n`);
  }
  process.stdout.write(`\nRules: ${rules.length} | distinct userIds: ${ruleUserIds.length}\n`);
  for (const uid of ruleUserIds) {
    const count = rules.filter((r) => r.userId === uid).length;
    process.stdout.write(`  rule.userId=${uid}: ${count} rules\n`);
  }

  // Categorize each product by whether at least one enabled title rule would load
  const titleRules = rules.filter((r) => r.category === "title" && r.enabled);
  let willMatch = 0;
  let willNotMatch = 0;
  const orphans: Array<{ id: string; userId: string | null; title: string }> = [];
  for (const p of products) {
    const matched = titleRules.some((r) => (p.userId ? r.userId === p.userId : true));
    if (matched) willMatch++;
    else { willNotMatch++; orphans.push({ id: p.id, userId: p.userId, title: p.title }); }
  }
  process.stdout.write(`\nProducts where title rule will MATCH: ${willMatch}\n`);
  process.stdout.write(`Products where title rule will NOT match: ${willNotMatch}\n`);
  if (orphans.length > 0) {
    process.stdout.write(`\nOrphan products (rule won't run):\n`);
    for (const o of orphans) {
      process.stdout.write(`  ${o.id}  userId=${o.userId}  "${o.title.slice(0, 60)}"\n`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
