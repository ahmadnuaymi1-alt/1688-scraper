/**
 * Set the final, hand-tuned monotonic price ladder across the jewellery-box
 * size family. Blends the comp anchors (2L/5L/7L) with corrections: 4L pulled
 * out of its comp-noise outlier into its logical slot, +$20 mirror premium on
 * 6L, 10L lifted above 7L. Every price is >= 2x landed floor and $4/$9-rounded;
 * compare-at is cleared (standing rule). Uniform within each size (same weight
 * + same CNY cost → same price). Sequential writes.
 *
 *   npx tsx scripts/_set-jewelry-prices.ts [--apply]
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
import { computeLandedFromRawPayload } from "../src/lib/pricing/landed-cost";

const APPLY = process.argv.includes("--apply");
const PRICES: Record<string, { label: string; price: number }> = {
  cmpxx12260001w2yspsqfr94i: { label: "2-Layer", price: 179 },
  cmpxx130y000hw2ys0d5ikvsb: { label: "4-Layer", price: 199 },
  cmpxx161q001pw2ysta9lvk0k: { label: "5-Layer", price: 229 },
  cmpxx1854002lw2ys7vdeln6v: { label: "6-Layer", price: 249 },
  cmpxx19xo003dw2ysoykzsyhg: { label: "7-Layer", price: 349 },
  cmpxx1auc003tw2ysfupa6ih9: { label: "10-Layer", price: 379 },
};

(async () => {
  for (const [cid, { label, price }] of Object.entries(PRICES)) {
    const prod = await prisma.product.findUnique({ where: { id: cid }, select: { rawPayload: true } });
    const b = prod ? computeLandedFromRawPayload(prod.rawPayload) : null;
    const floor = b ? b.landedUSD * 2 : null;
    const ok4or9 = price % 10 === 4 || price % 10 === 9;
    const aboveFloor = floor == null || price >= floor;
    console.log(`${label.padEnd(9)} $${price}  floor=$${floor?.toFixed(2) ?? "?"}  ${aboveFloor ? "OK>=floor" : "!! BELOW FLOOR"}  ${ok4or9 ? "$4/9" : "!! not 4/9"}`);
    if (!aboveFloor) { console.error(`  ABORT: ${label} below floor`); process.exit(1); }
    if (!APPLY) continue;
    await prisma.variant.updateMany({
      where: { productId: cid },
      data: { price: price.toFixed(2), compareAtPrice: null },
    });
  }
  if (!APPLY) console.log(`\n[dry-run] --apply to write`);
  else console.log(`\n✓ prices applied (compare-at cleared).`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
