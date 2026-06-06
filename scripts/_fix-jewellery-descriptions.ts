/**
 * Fix the jewellery-box children's descriptions:
 *   1. Rebuild productContext as proper JSON (it was overwritten with prose,
 *      breaking the rule's JSON.parse → no specs/dimensions). extractedSpecs now
 *      carries the size's real specs INCLUDING Dimensions (inches, W×H×D).
 *   2. Re-run the description rule → Dimensions land inside the <h3>Specifications</h3>
 *      table (not a standalone section), and the size-specific specs prevent the
 *      foreign-feature leak (no mirror on the 4/5-Layer, etc.).
 *   3. Scrub: drop any leftover standalone Dimensions block and any hedging
 *      ("approx", "not sure", "not found", "original source", "estimated").
 *
 *   npx tsx scripts/_fix-jewellery-descriptions.ts [--apply]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// dimsWHD: rule format "<W>\"W × <H>\"H × <D>\"D" (W=长/front, H=高/height, D=宽/depth).
// 7-Layer overall size is NOT printed on any spec card → omit (no hedging).
const SIZE: Record<string, { layers: number; dimsWHD: string | null; weightLb: number }> = {
  cmpxx12260001w2yspsqfr94i: { layers: 2, dimsWHD: '14.1"W × 5.1"H × 7.9"D', weightLb: 5.1 },
  cmpxx130y000hw2ys0d5ikvsb: { layers: 4, dimsWHD: '11.0"W × 7.9"H × 7.5"D', weightLb: 7.3 },
  cmpxx161q001pw2ysta9lvk0k: { layers: 5, dimsWHD: '11.0"W × 9.4"H × 7.5"D', weightLb: 8.4 },
  cmpxx1854002lw2ys7vdeln6v: { layers: 6, dimsWHD: '12.4"W × 9.6"H × 8.1"D', weightLb: 9.9 },
  cmpxx19xo003dw2ysoykzsyhg: { layers: 7, dimsWHD: null, weightLb: 11.5 },
  cmpxx1auc003tw2ysfupa6ih9: { layers: 10, dimsWHD: '12.6"W × 18.7"H × 9.4"D', weightLb: 14.3 },
};

const HEDGE = /(approximate|approx\.?|not sure|not found|original source|unconfirmed|estimated|roughly)/i;

function scrub(html: string): string {
  let h = html;
  // Drop any standalone Dimensions section (heading + the element right after).
  h = h.replace(/<h[23][^>]*>\s*Dimensions\s*<\/h[23]>\s*(<p>[\s\S]*?<\/p>|<ul>[\s\S]*?<\/ul>|<table>[\s\S]*?<\/table>)/gi, "");
  // Drop list items / table rows / paragraphs that carry hedging language.
  h = h.replace(/<li>(?:(?!<\/li>)[\s\S])*?(?:approximate|approx\.?|not sure|not found|original source|unconfirmed|estimated|roughly)(?:(?!<\/li>)[\s\S])*?<\/li>/gi, "");
  h = h.replace(/<tr>(?:(?!<\/tr>)[\s\S])*?(?:approximate|approx\.?|not sure|not found|original source|unconfirmed|estimated|roughly)(?:(?!<\/tr>)[\s\S])*?<\/tr>/gi, "");
  // Strip a lone "(approx.)" / "(approximate)" parenthetical if it survived inline.
  h = h.replace(/\s*\((?:approx\.?|approximate|estimated)\)/gi, "");
  return h.replace(/\s{2,}/g, " ").trim();
}

(async () => {
  const { reapplyRules } = await import("../src/services/rule.service");

  // ── 1. rebuild productContext (sequential) ──
  for (const [cid, meta] of Object.entries(SIZE)) {
    const child = await prisma.product.findUnique({
      where: { id: cid },
      include: { variants: { orderBy: { position: "asc" } } },
    });
    if (!child) { console.error(`! ${cid} missing`); continue; }
    const isLarge = meta.layers >= 7;

    // PRODUCT-LEVEL specs only (true for every variant of this size). Closure
    // (lock vs. hooks) and mirror vary BY VARIANT within a size, so they are
    // carried by the variant labels, not asserted as product-wide specs.
    const specs: Array<{ name: string; value: string }> = [];
    if (meta.dimsWHD) specs.push({ name: "Dimensions", value: meta.dimsWHD });
    specs.push({ name: "Material", value: "Solid wood and MDF with natural wood-grain veneer" });
    specs.push({ name: "Lining", value: "Soft velvet" });
    specs.push({ name: "Tiers", value: `${meta.layers}-tier (lift-lid top tray + stacked drawers)` });
    if (isLarge) specs.push({ name: "Capacity", value: "Extra-large multi-tier storage" });
    specs.push({ name: "Hardware", value: "Brass-tone" });
    specs.push({ name: "Weight", value: `${meta.weightLb} lb` });

    const featureCallouts = [
      `${meta.layers} velvet-lined tiers keep rings, earrings, necklaces and watches separated`,
      "Smooth-gliding drawers and a lift-lid top tray for easy access",
      "Vintage solid-wood construction with a warm, hand-finished wood grain",
      "Brass-tone hardware throughout",
    ];
    if (isLarge) featureCallouts.push("Extra-large capacity for a growing collection");
    const marketingAngles = [
      "Vintage solid-wood craftsmanship",
      "Organised multi-tier jewellery storage",
      "A considered gift for weddings and special occasions",
    ];

    console.log(`${meta.layers}L (${cid})  dims=${meta.dimsWHD ?? "OMITTED"}  specs=${specs.length}`);
    if (APPLY) {
      await prisma.product.update({
        where: { id: cid },
        data: { productContext: JSON.stringify({ extractedSpecs: specs, featureCallouts, marketingAngles }) },
      });
    }
  }

  if (!APPLY) { console.log("\n[dry-run] --apply to write context + re-run rule + scrub"); await prisma.$disconnect(); return; }

  // ── 2. re-run description rule (parallel) ──
  console.log(`\nRe-running description rule (parallel)...`);
  await Promise.all(Object.keys(SIZE).map((cid) =>
    reapplyRules(cid, ["description"]).then(() => console.log(`  ✓ desc ${cid}`)).catch((e) => console.warn(`  ! desc ${cid}: ${e instanceof Error ? e.message : e}`)),
  ));

  // ── 3. scrub + verify (sequential) ──
  console.log(`\nScrub + verify...`);
  for (const [cid, meta] of Object.entries(SIZE)) {
    const p = await prisma.product.findUnique({ where: { id: cid }, select: { descriptionHtml: true } });
    const before = p?.descriptionHtml ?? "";
    const after = scrub(before);
    if (after !== before) await prisma.product.update({ where: { id: cid }, data: { descriptionHtml: after } });
    const hedged = HEDGE.test(after);
    const hasSpecs = /<h[23][^>]*>\s*Specifications\s*<\/h[23]>/i.test(after);
    const dimsInSpecs = meta.dimsWHD ? after.includes(meta.dimsWHD.split(" ")[0]) : true; // W token present
    const standalone = /<h[23][^>]*>\s*Dimensions\s*<\/h[23]>/i.test(after);
    console.log(`  ${meta.layers}L  specs=${hasSpecs} dimsPresent=${dimsInSpecs} standaloneDimsBlock=${standalone} hedging=${hedged}${after !== before ? "  (scrubbed)" : ""}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
