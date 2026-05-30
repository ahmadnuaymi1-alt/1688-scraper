/**
 * Rewrite the "Standard tags" TransformationRule prompt so the LLM:
 *   1. Doesn't have a real example URL it can copy verbatim.
 *   2. Knows the URL format (so it can recognize one), explicitly labeled
 *      as a FORMAT, not a value.
 *   3. Is told to copy the "Source URL:" line from the product context
 *      verbatim — `applyTagsRules` now feeds that line in (separate edit
 *      to rule.service.ts).
 *
 *   npx tsx scripts/_update-tag-rule-prompt.ts
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

const NEW_PROMPT = `TAGS RULES, STRICT

Output exactly 10 tags in array field tags.

Tags must be unique, case-insensitive.

Each tag must be 1–3 words (with one exception — the SOURCE URL tag, see below).

Tags should be broad and collection-friendly, but still relevant to the product context.

Make the tags SEO-focused.

Prefer category, use-case, style, material, and feature tags.

The tags will ideally be used to create collections, so keep that in mind.

Avoid filler or promotional tags.

Never output ai_pending or ai_done.

SOURCE URL TAG (CRITICAL):

One of the 10 tags MUST be the product's actual source URL. Copy it EXACTLY from the "Source URL:" line in the Product context above. Do NOT invent one. Do NOT reuse a URL from a different product. Do NOT use the format string below as if it were a value.

The source URL is always shaped like this (FORMAT ONLY — replace the placeholder with the real URL from the product context, do not output the format string verbatim):

https://detail.1688.com/offer/<numeric-offer-id>.html

Example tags below are samples of the STYLE / SHAPE of tags — do not copy them verbatim, write tags specific to THIS product. The last entry is a stand-in for where the actual source URL belongs — replace it with the URL from the product context:

Table Lamp
USB Rechargeable Lamp
Touch Control Lamp
Sleek Lamp Design
Portable Lighting
Modern Table Lamp
LED Table Lamp
Eco-Friendly Lamp
Cordless Table Lamp
<source URL from product context>`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const rules = await prisma.transformationRule.findMany({
      where: { category: "tags" },
    });
    if (rules.length === 0) {
      console.error("No tag rules found.");
      process.exit(1);
    }
    let updated = 0;
    for (const rule of rules) {
      let config: { prompt?: string; model?: string };
      try {
        config = JSON.parse(rule.config);
      } catch {
        console.error(`Skipping rule "${rule.name}" — config not valid JSON.`);
        continue;
      }
      const oldPrompt = typeof config.prompt === "string" ? config.prompt : "";
      const hadOldUrl = /1688\.com\/offer\/1008724830559/.test(oldPrompt);
      config.prompt = NEW_PROMPT;
      await prisma.transformationRule.update({
        where: { id: rule.id },
        data: { config: JSON.stringify(config) },
      });
      console.log(
        `Updated rule "${rule.name}" (enabled=${rule.enabled})  oldPromptLen=${oldPrompt.length}  newPromptLen=${NEW_PROMPT.length}  hadPlaceholderURL=${hadOldUrl}`,
      );
      updated++;
    }
    console.log(`\nDone. Updated ${updated} rule(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
