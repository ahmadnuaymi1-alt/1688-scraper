/**
 * For each of the 5 dim-target products:
 *   1. Restore the rich base description by calling rewriteProductDescription()
 *      (regenerates HTML from productContext.extractedSpecs verbatim).
 *   2. Re-apply the (now-fixed) description-category TransformationRules.
 *   3. Verify: every "Dimensions (...)" / "Coverage Area (...)" / etc spec
 *      row from productContext appears in the final descriptionHtml.
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

const PRODUCT_IDS = [
  "cmpjsug3l00cpw2gg1r25v59u",
];

async function main() {
  const { rewriteProductDescription } = await import("../src/services/description-enrichment.service");
  const { applyRulesByCategory } = await import("../src/services/rule.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  const prisma = new PrismaClient();

  for (const id of PRODUCT_IDS) {
    console.log(`\n======================================================`);
    console.log(`  ${id}`);
    console.log(`======================================================`);

    // Pull dim-shaped spec NAMES BEFORE we run anything, for the check at the end.
    const before = await prisma.product.findUnique({
      where: { id },
      select: { productContext: true },
    });
    const ctx = before?.productContext ? JSON.parse(before.productContext) : null;
    const specs: Array<{ name: string; value: string }> = ctx?.extractedSpecs ?? [];
    const dimSpecNames = specs
      .filter((s) =>
        /\b(dimensions?|coverage area|coverage|applicable area|light source power|power)\b/i.test(s.name) &&
        /\(/.test(s.name), // only the per-style ones (parenthesized)
      )
      .map((s) => s.name);
    console.log(`Per-variant spec rows to preserve: ${dimSpecNames.length}`);
    for (const n of dimSpecNames) console.log(`  - ${n}`);

    // Step 1: regenerate rich base description from productContext.
    console.log(`\n[1] rewriteProductDescription()…`);
    try {
      await rewriteProductDescription(id);
      console.log(`    OK`);
    } catch (e) {
      console.log(`    FAIL: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    // Step 2: re-apply description-category rules (the user's "Standard
    // description" rule is in this category).
    console.log(`[2] applyRulesByCategory(description)…`);
    try {
      await applyRulesByCategory(id, "description", DEFAULT_SCRAPE_OPTIONS);
      console.log(`    OK`);
    } catch (e) {
      console.log(`    FAIL: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    // Step 3: verify every per-variant spec name landed in the final HTML.
    const after = await prisma.product.findUnique({
      where: { id },
      select: { descriptionHtml: true },
    });
    const html = after?.descriptionHtml ?? "";
    console.log(`[3] Final descriptionHtml: ${html.length} chars`);

    const missing: string[] = [];
    const present: string[] = [];
    for (const name of dimSpecNames) {
      // We don't require the full "Dimensions (X)" string to match verbatim —
      // the rule may comma-group ("Minglan, Shuya Dimensions"). We just want
      // the variant attribution (the bit in parens) to appear somewhere.
      const m = name.match(/\(([^)]+)\)/);
      const variantTag = m ? m[1].trim() : name;
      const re = new RegExp(variantTag.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "i");
      if (re.test(html)) present.push(`${name} -> "${variantTag}"`);
      else missing.push(`${name} -> "${variantTag}"`);
    }
    console.log(`    present: ${present.length}/${dimSpecNames.length}`);
    if (missing.length > 0) {
      console.log(`    MISSING ${missing.length}:`);
      for (const x of missing) console.log(`      - ${x}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
