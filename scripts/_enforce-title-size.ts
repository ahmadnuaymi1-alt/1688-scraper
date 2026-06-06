/**
 * The title rule keeps generic "Multi-Layer"/"Tiered"/"Large Capacity" instead
 * of the specific tier count, so size-split products aren't differentiated.
 * Inject the exact "{N}-Layer" into each rule-generated title (preserving the
 * rule's descriptors) + normalise Jewellery→Jewelry for line consistency.
 *
 *   npx tsx scripts/_enforce-title-size.ts [--apply]
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
const CHILDREN: Record<string, number> = {
  cmpxx12260001w2yspsqfr94i: 2,
  cmpxx130y000hw2ys0d5ikvsb: 4,
  cmpxx161q001pw2ysta9lvk0k: 5,
  cmpxx1854002lw2ys7vdeln6v: 6,
  cmpxx19xo003dw2ysoykzsyhg: 7,
  cmpxx1auc003tw2ysfupa6ih9: 10,
};

function enforce(title: string, n: number): string {
  let t = title.replace(/Jewellery/g, "Jewelry");
  const tag = `${n}-Layer`;
  // Replace any generic multi-tier descriptor with the exact count.
  t = t.replace(/\bMulti[-\s]?Layer\b/gi, tag).replace(/\bMulti[-\s]?Tier(ed)?\b/gi, tag).replace(/\bTiered\b/gi, tag);
  // If the exact count still isn't present, insert it after "Vintage Solid Wood".
  if (!new RegExp(`\\b${n}-Layer\\b`, "i").test(t)) {
    if (/Vintage Solid Wood/i.test(t)) t = t.replace(/(Vintage Solid Wood)\s+/i, `$1 ${tag} `);
    else t = `${tag} ${t}`;
  }
  // Keep only the FIRST "N-Layer"; drop any later repeats (adjacent or not).
  let seen = false;
  t = t.replace(new RegExp(`\\b${n}-Layer\\b`, "gi"), () => {
    if (seen) return "";
    seen = true;
    return tag;
  });
  return t.replace(/\s{2,}/g, " ").trim();
}

(async () => {
  for (const [cid, n] of Object.entries(CHILDREN)) {
    const p = await prisma.product.findUnique({ where: { id: cid }, select: { title: true } });
    if (!p) continue;
    const next = enforce(p.title, n);
    console.log(`${n.toString().padStart(2)}L  ${p.title}\n     -> ${next}`);
    if (APPLY && next !== p.title) {
      await prisma.product.update({ where: { id: cid }, data: { title: next } });
    }
  }
  if (!APPLY) console.log(`\n[dry-run] --apply to write`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
