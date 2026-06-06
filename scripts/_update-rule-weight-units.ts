/**
 * Add a "Weight row — show both grams and lbs" instruction to the user's
 * "Standard description" TransformationRule (cmp30839w002gw2o4rm24nsc4).
 *
 * Insertion point: immediately above the existing "DROP IMPLAUSIBLE /
 * ERROR VALUES" block, so weight handling rules are grouped together.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const RULE_ID = "cmp30839w002gw2o4rm24nsc4";

const NEW_BLOCK = `WEIGHT ROW — show BOTH metric and imperial:

When the source provides a weight for the product, render the Specifications "Weight" row in BOTH grams (or kg, if the source is in kg) AND pounds — e.g. "Weight: 908 g / 2.0 lb" or "Weight: 3.5 kg / 7.7 lb". Convert at 1 lb = 453.59 g (or 1 kg = 2.205 lb), round the imperial side to 1 decimal place. If the source omits weight entirely, omit the row. The IMPLAUSIBLE / ERROR VALUES rule below still applies — drop weights that are obviously wrong (e.g. 2 g for a large metal fixture).

`;

async function main() {
  const prisma = new PrismaClient();
  const rule = await prisma.transformationRule.findUnique({ where: { id: RULE_ID }, select: { name: true, config: true } });
  if (!rule) { console.log("rule not found"); process.exit(1); }
  const cfg = JSON.parse(rule.config) as { prompt: string; model: string };
  console.log(`rule: ${rule.name}, model: ${cfg.model}, prompt length: ${cfg.prompt.length}`);

  // Idempotency — skip if already inserted.
  if (cfg.prompt.includes("WEIGHT ROW — show BOTH metric and imperial")) {
    console.log("\nWeight row instruction already present — no change");
    await prisma.$disconnect();
    return;
  }

  // Anchor: "DROP IMPLAUSIBLE / ERROR VALUES:" is unique in the prompt.
  const ANCHOR = "DROP IMPLAUSIBLE / ERROR VALUES:";
  const i = cfg.prompt.indexOf(ANCHOR);
  if (i < 0) {
    console.log("\nERROR: anchor 'DROP IMPLAUSIBLE / ERROR VALUES:' not found in prompt");
    process.exit(1);
  }
  const newPrompt = cfg.prompt.slice(0, i) + NEW_BLOCK + cfg.prompt.slice(i);
  const newCfg = JSON.stringify({ ...cfg, prompt: newPrompt });
  await prisma.transformationRule.update({ where: { id: RULE_ID }, data: { config: newCfg } });

  console.log(`\nNew prompt length: ${newPrompt.length} (was ${cfg.prompt.length}, +${newPrompt.length - cfg.prompt.length} chars)`);
  console.log("Inserted Weight g/lb block above DROP IMPLAUSIBLE.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
