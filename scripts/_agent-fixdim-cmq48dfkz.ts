/**
 * Step 2 dimension fix: spec table said `17.5" × 13.5" × 12" size variants`
 * but true value is 17.5 × 13.5 × 12 CM (single size). Convert cm->in and
 * drop the false "size variants" implication.
 *   17.5cm=6.9"  13.5cm=5.3"  12cm=4.7"
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
function loadEnvLocal(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
const ID = "cmq48dfkz000jw2ik1ziakg6o";
async function main() {
  const prisma = new PrismaClient();
  const r = await prisma.product.findUnique({ where: { id: ID }, select: { descriptionHtml: true } });
  let html = r?.descriptionHtml ?? "";
  const bad = '17.5" × 13.5" × 12" size variants';
  const good = '6.9" × 5.3" × 4.7" (17.5 × 13.5 × 12 cm)';
  if (html.includes(bad)) {
    html = html.replace(bad, good);
    await prisma.product.update({ where: { id: ID }, data: { descriptionHtml: html } });
    console.log(`Dimensions row: '${bad}' -> '${good}'`);
  } else {
    console.log(`Dimensions row token not found (already fixed?). Current contains '6.9"': ${html.includes('6.9"')}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
