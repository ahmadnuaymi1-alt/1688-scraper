/**
 * Update the user's "Standard description" TransformationRule
 * (cmp30839w002gw2o4rm24nsc4) to mandate per-style dimensional row preservation.
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

async function main() {
  const prisma = new PrismaClient();
  const rule = await prisma.transformationRule.findUnique({ where: { id: RULE_ID } });
  if (!rule) { console.log("RULE NOT FOUND"); process.exit(1); }
  const config = JSON.parse(rule.config) as { prompt: string; model: string };
  console.log(`BEFORE — prompt length: ${config.prompt.length}`);

  // Insert the new PER-STYLE DIMENSIONS block right before the SPECIFICATIONS TAB section.
  const specMarker = "=== SPECIFICATIONS TAB ===";
  if (!config.prompt.includes(specMarker)) {
    console.log("ERROR: Specifications-tab marker not found; aborting");
    process.exit(1);
  }

  const insertBlock = `🚨 PER-STYLE / PER-VARIANT DIMENSIONS — STRICT PRESERVATION 🚨

When the source extractedSpecs contain rows like:
  - "Dimensions (Yunshi Small)" / "Dimensions (Yunshi Medium)" / "Dimensions (Jingyu)" / "Dimensions (Suiyun)"
  - "Dimensions (2-Head)" / "Dimensions (4-Head)" / "Dimensions (6-Head)" / "Dimensions (8-Head)"
  - "Minglan, Shuya Dimensions" / "Jingyi Dimensions"
  - "Light Source Power (Small/Medium)" / "Applicable Area (14W)" / "Coverage Area (2-Head)"

YOU MUST:
1. Render EVERY single one of those rows in the Specifications table — one <tr> per row.
2. Keep the parenthetical label EXACTLY as given. NEVER rename "Yunshi Small" → "Small". NEVER rename "2-Head" → "Small". NEVER drop the style/variant name from the spec name. NEVER collapse "Dimensions (Yunshi Small)" + "Dimensions (Jingyu Small)" into a single "Dimensions (Small)" row.
3. Comma-grouped style names (e.g. "Minglan, Shuya Dimensions") stay as one row — do NOT split into separate rows per style.
4. Only collapse two rows into one when the values are IDENTICAL AND the labels refer to the same configuration (NOT when labels are distinct styles or variant configs).
5. Convert cm → inches (0.5" resolution) and m² → sq ft per the UNITS RULES below, but keep the parenthetical label intact during conversion.

EXAMPLE — CORRECT OUTPUT (cmpjstlof, cloud stone wall lamp):
<tr><th>Dimensions (Yunshi Small)</th><td>15.7"W × 2.4"H × 3.9"D</td></tr>
<tr><th>Dimensions (Yunshi Medium)</th><td>19.7"W × 2.4"H × 3.9"D</td></tr>
<tr><th>Dimensions (Yunshi Large)</th><td>23.6"W × 2.4"H × 3.9"D</td></tr>
<tr><th>Dimensions (Jingyu)</th><td>...</td></tr>
<tr><th>Dimensions (Suiyun)</th><td>...</td></tr>

EXAMPLE — WRONG (do NOT do this):
<tr><th>Dimensions (Small)</th><td>15.7"W × 2.4"H</td></tr>
<tr><th>Dimensions (Medium)</th><td>19.7"W × 2.4"H</td></tr>
<tr><th>Dimensions (Large)</th><td>23.6"W × 2.4"H</td></tr>
(WRONG because "Yunshi" / "Jingyu" / "Suiyun" attribution was dropped — customer can't tell which style each row belongs to.)

EXAMPLE — CORRECT OUTPUT (cmpjstyid, solar lamp with head-count variants):
<tr><th>Dimensions (2-Head)</th><td>...</td></tr>
<tr><th>Dimensions (4-Head)</th><td>...</td></tr>
<tr><th>Dimensions (6-Head)</th><td>...</td></tr>
<tr><th>Dimensions (8-Head)</th><td>...</td></tr>

NEVER omit per-variant dimensional rows. NEVER consolidate them into a generic "Dimensions" row. This is non-negotiable — the customer relies on these to choose the right variant.

`;

  const newPrompt = config.prompt.replace(specMarker, `${insertBlock}${specMarker}`);
  if (newPrompt === config.prompt) {
    console.log("ERROR: replace had no effect; aborting");
    process.exit(1);
  }

  const newConfig = JSON.stringify({ ...config, prompt: newPrompt });
  await prisma.transformationRule.update({ where: { id: RULE_ID }, data: { config: newConfig } });
  console.log(`AFTER — prompt length: ${newPrompt.length}`);
  console.log("\nUpdated. Inserted PER-STYLE DIMENSIONS block before SPECIFICATIONS TAB.");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
