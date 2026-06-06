/**
 * Verify the updated rule renders Weight as both g and lb on a product whose
 * supplier weight is known (Iron Walnut Fan, 908g).
 *
 * Approach: call rewriteProductDescription() to refresh the base description
 * from cached productContext, then applyRulesByCategory("description") which
 * runs the updated "Standard description" rule. Then look for the Weight row
 * in the resulting descriptionHtml.
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

const PRODUCT_ID = process.argv[2] ?? "cmpspc34s00j0w24c40x2tikh";

async function main() {
  const { rewriteProductDescription } = await import("../src/services/description-enrichment.service");
  const { applyRulesByCategory } = await import("../src/services/rule.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  const prisma = new PrismaClient();
  console.log(`\nProduct: ${PRODUCT_ID}`);

  // 1) Regenerate base description from cached context.
  console.log(`[1/2] rewriteProductDescription() — regenerating base description from productContext…`);
  await rewriteProductDescription(PRODUCT_ID);

  // 2) Apply user's "Standard description" rule with the new instruction.
  console.log(`[2/2] applyRulesByCategory(description) — applying user's rule…`);
  await applyRulesByCategory(PRODUCT_ID, "description", DEFAULT_SCRAPE_OPTIONS);

  // Look at the result.
  const after = await prisma.product.findUnique({ where: { id: PRODUCT_ID }, select: { title: true, descriptionHtml: true } });
  const html = after?.descriptionHtml ?? "";
  console.log(`\nTitle: ${after?.title?.slice(0, 70)}`);
  console.log(`descriptionHtml length: ${html.length}`);

  // Find the specifications table and extract the Weight row.
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) { console.log("\nNo <table> found in descriptionHtml"); process.exit(0); }
  console.log(`\n--- Specifications table ---`);
  console.log(tableMatch[0]);

  // Surface the Weight row(s) specifically.
  const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const weightRows = rows.filter((r) => /weight/i.test(r[0]));
  console.log(`\n--- Weight row(s) (${weightRows.length}) ---`);
  for (const r of weightRows) console.log(r[0]);

  // Check: does at least one weight row contain BOTH "g" AND "lb"?
  const hasBoth = weightRows.some((r) => /\d.*\bg\b/i.test(r[0]) && /\d.*\blb\b/i.test(r[0]));
  console.log(`\nWeight row shows BOTH g and lb? ${hasBoth ? "✓ YES" : "✗ NO"}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
