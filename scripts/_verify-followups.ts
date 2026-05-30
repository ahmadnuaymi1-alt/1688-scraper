/**
 * Verify the 5 follow-up patches landed correctly on the 5 problem products.
 *   - A: Style/Model axis values randomized (distinct, not collision-collapsed)
 *   - B: compareAt cleared where omitCompareAtPrice was set
 *   - C: mixed-unit "50 × 6 cm" → "19.5\" × 2.5\""
 *   - D: short descriptions re-enriched to > 500 chars
 *   - E: drop-axis backend accepts orphan-column cleanup (probed via DB state)
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

const PRODUCTS = [
  { id: "cmpjstlof005zw2ggy9gucyhh", checks: ["compareAt=0", "size-mixed-unit", "style-randomized"] },
  { id: "cmpjsx9f700thw2gg2r2kiukv", checks: ["compareAt=0", "style-distinct", "opt2/3-cleanable"] },
  { id: "cmpjsxx7n010pw2ggqsx242gf", checks: ["style-distinct"] },
  { id: "cmpjswf6e00njw2ggf8fceqtd", checks: ["desc>500", "model-distinct"] },
  { id: "cmpjsv24600f9w2ggmzvuyfx3", checks: ["desc>500", "opt2-cleanable"] },
  { id: "cmpjstemm004fw2ggzp3ur3wo", checks: ["opt2-cleanable"] },
];

async function main() {
  const prisma = new PrismaClient();
  for (const { id, checks } of PRODUCTS) {
    console.log(`\n=== ${id} ===`);
    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        title: true,
        optionNames: true,
        descriptionHtml: true,
        variants: {
          orderBy: { position: "asc" },
          select: {
            isHidden: true,
            option1: true,
            option2: true,
            option3: true,
            price: true,
            compareAtPrice: true,
          },
        },
      },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    const optNames = p.optionNames ? JSON.parse(p.optionNames) : [];
    const visible = p.variants.filter((v) => !v.isHidden);
    const html = p.descriptionHtml ?? "";
    const stripped = html.replace(/<[^>]+>/g, "").trim();
    console.log(`  Title: ${p.title.slice(0, 60)}`);
    console.log(`  optionNames: [${optNames.join(", ")}]`);
    console.log(`  Visible: ${visible.length}  HiddenWithOpt2: ${p.variants.filter((v) => v.isHidden && v.option2).length}  HiddenWithOpt3: ${p.variants.filter((v) => v.isHidden && v.option3).length}`);
    console.log(`  Desc: ${html.length} chars total, ${stripped.length} stripped text`);
    const compareCount = visible.filter((v) => v.compareAtPrice).length;
    console.log(`  CompareAt count (visible): ${compareCount}`);
    // Show first 6 visible variants
    console.log(`  Visible variants (first 6):`);
    for (const v of visible.slice(0, 6)) {
      console.log(`    opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" price=${v.price} compareAt=${v.compareAtPrice}`);
    }
    // Per-check
    for (const c of checks) {
      let status = "?";
      if (c === "compareAt=0") status = compareCount === 0 ? "PASS" : `FAIL (${compareCount} variants still have compareAt)`;
      else if (c === "size-mixed-unit") {
        const hasMixedUnit = visible.some((v) => /\d+ × \d+(\.\d+)?"/.test(v.option3 ?? "") || /\d+ × \d+(\.\d+)?"/.test(v.option2 ?? "") || /\d+ × \d+(\.\d+)?"/.test(v.option1 ?? ""));
        // The expected good pattern is "19.5\" × 2.5\"" — both sides converted
        const hasDoubleInch = visible.some((v) => /\d+(\.\d+)?"\s*×\s*\d+(\.\d+)?"/.test(`${v.option1 ?? ""} ${v.option2 ?? ""} ${v.option3 ?? ""}`));
        status = hasDoubleInch ? "PASS (both sides converted to inches)" : `FAIL or N/A (no double-inch values)`;
      }
      else if (c === "style-randomized" || c === "style-distinct" || c === "model-distinct") {
        // Style axis values should be distinct (not collapsed)
        const styleIdx = optNames.findIndex((n: string) => /^(style|model|type|series|sku|item|design|collection)$/i.test(n.trim()));
        if (styleIdx < 0) { status = "N/A (no Style/Model axis)"; }
        else {
          const key = (["option1", "option2", "option3"] as const)[styleIdx];
          const uniqueVals = new Set(visible.map((v) => v[key]).filter(Boolean));
          status = uniqueVals.size >= Math.min(visible.length, 3)
            ? `PASS (${uniqueVals.size} distinct values across ${visible.length} variants)`
            : `FAIL (only ${uniqueVals.size} unique values for ${visible.length} variants)`;
        }
      }
      else if (c === "desc>500") status = stripped.length >= 500 ? `PASS (${stripped.length} stripped chars)` : `FAIL (${stripped.length} chars)`;
      else if (c === "opt2-cleanable" || c === "opt2/3-cleanable") {
        // Visible variants should have no option2 (and option3 if applicable) data
        const visOpt2 = visible.filter((v) => v.option2 && v.option2.trim()).length;
        const visOpt3 = visible.filter((v) => v.option3 && v.option3.trim()).length;
        if (c === "opt2-cleanable") status = visOpt2 === 0 ? "PASS (opt2 empty on visibles)" : `FAIL (${visOpt2} visibles have opt2)`;
        else status = visOpt2 === 0 && visOpt3 === 0 ? "PASS (opt2 + opt3 empty on visibles)" : `FAIL (opt2:${visOpt2}, opt3:${visOpt3})`;
      }
      console.log(`  [${c}] ${status}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
