/**
 * Final verification pass on all 5 dim-target products. For each:
 *   - Print the Specifications table from descriptionHtml.
 *   - Compare every productContext.extractedSpecs name against the html;
 *     flag any spec that didn't make it through (allowing comma-grouped or
 *     consolidated rendering — we look for the variant tag, not the full
 *     verbatim name).
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
  "cmpjswf6e00njw2ggf8fceqtd",
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsug3l00cpw2gg1r25v59u",
  "cmpjstyid007tw2ggulv0g8b3",
  "cmpjstlof005zw2ggy9gucyhh",
];

// Specs we deliberately do NOT carry through to the customer-facing
// description (the rule's OMIT list); missing these is fine.
const OMIT_RE =
  /^(item|model|sku|brand article|country of origin|origin|made in|manufacturer location|warranty|after.sales|stock|moq|品牌|颜色分类|颜色|价格|尺寸|规格|包装|productid|product id|skuid|specid|productname|spu)\b/i;

// Substrings/terms to look for inside the html (case-insensitive)
function specSignal(name: string, value: string): string {
  // For specs with a parenthetical tag, look for the tag.
  const m = name.match(/\(([^)]+)\)/);
  if (m) return m[1].trim();
  // Otherwise look for the first meaningful word of the value or name.
  return name.split(/[\s,]/)[0] ?? name;
}

async function main() {
  const prisma = new PrismaClient();
  let overallMissing = 0;

  for (const id of PRODUCT_IDS) {
    console.log(`\n========================================================`);
    console.log(`  ${id}`);
    console.log(`========================================================`);
    const p = await prisma.product.findUnique({
      where: { id },
      select: { title: true, descriptionHtml: true, productContext: true },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    console.log(`Title: ${p.title}`);

    const html = p.descriptionHtml ?? "";
    const ctx = p.productContext ? JSON.parse(p.productContext) : null;
    const specs: Array<{ name: string; value: string }> = ctx?.extractedSpecs ?? [];

    // Print the Specifications table.
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
    if (tableMatch) {
      console.log(`\n--- Specifications table (${tableMatch[0].length} chars) ---`);
      console.log(tableMatch[0]);
    } else {
      console.log(`\n!!! NO <table> found in descriptionHtml !!!`);
    }

    // Coverage check.
    console.log(`\n--- Coverage check (${specs.length} source specs) ---`);
    const missing: string[] = [];
    for (const s of specs) {
      if (OMIT_RE.test(s.name)) continue;
      const sig = specSignal(s.name, s.value);
      // Strip common html escape — comparing on text content not HTML
      const re = new RegExp(sig.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"), "i");
      if (!re.test(html)) missing.push(`  - "${s.name}" (signal="${sig}") = ${String(s.value).slice(0, 60)}`);
    }
    if (missing.length === 0) {
      console.log(`OK — every non-omitted spec has a signal in descriptionHtml`);
    } else {
      console.log(`MISSING ${missing.length} of ${specs.length} specs:`);
      for (const m of missing) console.log(m);
      overallMissing += missing.length;
    }
  }

  console.log(`\n========================================================`);
  console.log(`TOTAL specs missing across all 5 products: ${overallMissing}`);
  console.log(`========================================================`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
