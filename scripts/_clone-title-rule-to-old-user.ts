/**
 * Duplicate the (already-updated) long title rule under the orphan user's
 * userId so the 3 products belonging to that account also get re-titled.
 *
 * The orphan user inherited a short title rule that we disabled — without a
 * replacement under their userId, loadRulesForCategory returns 0 rules for
 * their products and applyTitleRules silently no-ops (which is why the 3
 * orphans came back unchanged in the batch re-run).
 *
 *   npx tsx scripts/_clone-title-rule-to-old-user.ts [--dry-run]
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

const SOURCE_RULE_ID = "cmp307yrd002ew2o4j0z773yb"; // long title rule, main user
const ORPHAN_USER_ID = "cmp2vfof30000w2s8jwg0qf7c";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  const source = await prisma.transformationRule.findUnique({ where: { id: SOURCE_RULE_ID } });
  if (!source) { process.stderr.write(`Source rule ${SOURCE_RULE_ID} missing\n`); process.exit(1); }

  // Did we already create one? Look for any enabled title rule under the orphan user.
  const existing = await prisma.transformationRule.findFirst({
    where: { category: "title", enabled: true, userId: ORPHAN_USER_ID },
  });
  if (existing) {
    process.stdout.write(`Orphan user already has an enabled title rule: ${existing.id} (${existing.name})\n`);
    process.stdout.write(`  Updating its config to match the main rule (instead of creating a duplicate).\n`);
    if (!dryRun) {
      await prisma.transformationRule.update({
        where: { id: existing.id },
        data: { config: source.config, name: source.name },
      });
      process.stdout.write(`  ✓ Updated.\n`);
    } else {
      process.stdout.write(`  (dry-run)\n`);
    }
  } else {
    process.stdout.write(`Cloning rule ${SOURCE_RULE_ID} under userId=${ORPHAN_USER_ID}\n`);
    process.stdout.write(`  name: ${source.name}\n`);
    process.stdout.write(`  category: ${source.category}\n`);
    process.stdout.write(`  enabled: true\n`);
    process.stdout.write(`  config length: ${source.config.length}\n`);
    if (!dryRun) {
      const created = await prisma.transformationRule.create({
        data: {
          name: source.name,
          category: source.category,
          enabled: true,
          config: source.config,
          userId: ORPHAN_USER_ID,
        },
      });
      process.stdout.write(`  ✓ Created rule ${created.id}\n`);
    } else {
      process.stdout.write(`  (dry-run)\n`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
