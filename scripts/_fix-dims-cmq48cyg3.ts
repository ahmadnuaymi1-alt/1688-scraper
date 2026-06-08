/**
 * Correct per-style Dimensions rows in productContext.extractedSpecs for
 * cmq48cyg3 (jewelry box). Values re-derived from the gallery CM annotations
 * (authoritative). Preserves the per-style labels verbatim (rewrite-rule-per-
 * style-preservation memory). Single sequential write.
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
const ID = "cmq48cyg3000jw2g46nf689gj";

// label (exact) -> corrected value
const CORRECT: Record<string, string> = {
  "Fulu 4-Tier, Monogram Leather Top Dimensions": '10.2"W × 6.5"H × 7.3"D',
  "Fulu 3-Tier, Monogram Leather Top Dimensions": '10.2"W × 5.2"H × 7.3"D',
  "Begonia Window 3-Drawer, Black Walnut Veneer Dimensions": '10.2"W × 6.3"H × 7.7"D',
  "Compact Cabinet 4-Drawer, Solid Walnut Dimensions": '5.1"W × 7.5"H × 5.1"D',
  "Fulu 4-Tier, Gray Velvet Top Dimensions": '10.2"W × 6.5"H × 7.3"D',
  "Fulu 3-Tier, Gray Velvet Top Dimensions": '10.2"W × 5.2"H × 7.3"D',
  "4-Tier Box, Minimalist Dimensions": '10.2"W × 6.5"H × 7.3"D',
  "3-Tier Box, Minimalist Dimensions": '10.2"W × 5.2"H × 7.3"D',
};

async function main() {
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({ where: { id: ID }, select: { productContext: true } });
  if (!r) { console.log("NOT FOUND"); process.exit(1); }
  let ctx: any = r.productContext;
  if (typeof ctx === "string") ctx = JSON.parse(ctx);
  const specs: Array<{ name: string; value: string }> = ctx.extractedSpecs ?? [];

  let changed = 0;
  for (const s of specs) {
    if (Object.prototype.hasOwnProperty.call(CORRECT, s.name)) {
      const next = CORRECT[s.name];
      if (s.value !== next) {
        console.log(`FIX  ${s.name}\n     "${s.value}" -> "${next}"`);
        s.value = next;
        changed++;
      } else {
        console.log(`OK   ${s.name}  (already "${s.value}")`);
      }
    }
  }
  ctx.extractedSpecs = specs;

  // persist as same shape (string or object) it was stored as
  const dataVal = typeof r.productContext === "string" ? JSON.stringify(ctx) : ctx;
  await prisma.product.update({ where: { id: ID }, data: { productContext: dataVal as any } });
  console.log(`\nWrote ${changed} corrected Dimensions rows to productContext.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
