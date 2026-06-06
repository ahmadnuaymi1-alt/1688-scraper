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

const CHILDREN = [
  "cmpxx12260001w2yspsqfr94i",
  "cmpxx130y000hw2ys0d5ikvsb",
  "cmpxx161q001pw2ysta9lvk0k",
  "cmpxx1854002lw2ys7vdeln6v",
  "cmpxx19xo003dw2ysoykzsyhg",
  "cmpxx1auc003tw2ysfupa6ih9",
];

(async () => {
  console.log("size".padEnd(10), "CNY".padEnd(5), "wt(g)".padEnd(6), "USD".padEnd(7), "ship".padEnd(6), "landed".padEnd(8), "2x floor");
  for (const cid of CHILDREN) {
    const p = await prisma.product.findUnique({ where: { id: cid }, select: { title: true, rawPayload: true } });
    if (!p) { console.log(cid, "MISSING"); continue; }
    const b = computeLandedFromRawPayload(p.rawPayload);
    const size = p.title.split("—").pop()?.trim() ?? "?";
    if (!b) { console.log(size.padEnd(10), "landed=null"); continue; }
    console.log(
      size.padEnd(10),
      String(b.supplierCNY).padEnd(5),
      String(b.weightG).padEnd(6),
      `$${b.supplierUSD}`.padEnd(7),
      `$${b.shippingUSD}`.padEnd(6),
      `$${b.landedUSD}`.padEnd(8),
      `$${(b.landedUSD * 2).toFixed(2)}  (${b.weightSource})`,
    );
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
