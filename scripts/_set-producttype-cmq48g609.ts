/**
 * STEP 1 variant-intelligence DB write for cmq48g609000jw2oo2ubz3vrm (watch).
 * Decision summary:
 *  - 3 visible variants (Steel blue / green / black dial) — Vision-confirmed accurate.
 *  - Identical silver stainless case + bracelet across all three; only dial colour differs.
 *  - Single-axis "Color" split is correct (easiest for customer). No axis-split, no dedup,
 *    no packaging-accessory variants, no pack-axis false-positive to unhide.
 *  - Only required write: productType was null → set "watch".
 * Sequential write, single connection.
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

const PID = "cmq48g609000jw2oo2ubz3vrm";

(async () => {
  const p = new PrismaClient();
  try {
    const before = await p.product.findUnique({ where: { id: PID }, select: { productType: true } });
    console.log("productType before:", JSON.stringify(before?.productType));
    if (before?.productType == null) {
      await p.product.update({ where: { id: PID }, data: { productType: "watch" } });
      console.log('SET productType = "watch"');
    } else {
      console.log("productType already set; leaving as-is.");
    }
    const after = await p.product.findUnique({ where: { id: PID }, select: { productType: true } });
    console.log("productType after:", JSON.stringify(after?.productType));
  } finally {
    await p.$disconnect();
  }
})();
