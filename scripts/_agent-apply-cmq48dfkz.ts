/**
 * Agent-mode Step 1 DB writes (SEQUENTIAL, connection_limit=1):
 *  - set productType = "jewelry-box"
 *  - rename "Nude Pink" variant -> "Champagne" (vision: champagne/cream, not pink)
 *  - update descriptionHtml Color row "Black, Nude Pink" -> "Black, Champagne"
 * Idempotent.
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

  // 1) productType
  const before = await prisma.product.findUnique({ where: { id: ID }, select: { productType: true, descriptionHtml: true, tags: true } });
  if (before?.productType !== "jewelry-box") {
    await prisma.product.update({ where: { id: ID }, data: { productType: "jewelry-box" } });
    console.log(`productType: ${JSON.stringify(before?.productType)} -> "jewelry-box"`);
  } else {
    console.log(`productType already "jewelry-box"`);
  }

  // 2) rename Nude Pink -> Champagne (option1 + title)
  const npVar = await prisma.variant.findFirst({ where: { productId: ID, option1: "Nude Pink" } });
  if (npVar) {
    await prisma.variant.update({ where: { id: npVar.id }, data: { option1: "Champagne", title: "Champagne" } });
    console.log(`variant "Nude Pink" -> "Champagne" (id=${npVar.id})`);
  } else {
    console.log(`no "Nude Pink" variant found (already renamed?)`);
  }

  // 3) description Color row
  const cur = before?.descriptionHtml ?? "";
  if (cur.includes("Black, Nude Pink")) {
    const next = cur.replace("Black, Nude Pink", "Black, Champagne")
                    .replace(/live options are Black and Nude Pink/gi, "live options are Black and Champagne");
    await prisma.product.update({ where: { id: ID }, data: { descriptionHtml: next } });
    console.log(`descriptionHtml Color row updated -> "Black, Champagne"`);
  } else {
    console.log(`descriptionHtml had no "Black, Nude Pink" token (skipped)`);
  }

  // verify
  const after = await prisma.product.findUnique({ where: { id: ID }, select: { productType: true }, });
  const vs = await prisma.variant.findMany({ where: { productId: ID }, orderBy: { position: "asc" }, select: { position: true, option1: true, isHidden: true } });
  console.log(`\nAFTER: productType=${after?.productType}  variants=${JSON.stringify(vs)}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
