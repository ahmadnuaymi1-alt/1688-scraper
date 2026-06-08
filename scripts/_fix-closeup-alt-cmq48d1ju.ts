import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
function loadEnv(): void {
  const e = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(e)) return;
  for (const l of fs.readFileSync(e, "utf-8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
const PID = "cmq48d1ju000jw2gowuwbmolt";
(async () => {
  const prisma = new PrismaClient();
  try {
    const close = await prisma.productImage.findFirst({ where: { productId: PID, imageType: "closeup" }, select: { id: true, fileName: true } });
    if (!close) { console.log("no closeup row"); return; }
    const newFile = "Stainless-Steel-Round-Dual-Calendar-Quartz-Analog-Mens-Wrist-Watch-dial-macro-close-up-detail.png";
    const newAlt = "Macro close-up of the blue starry sky dial, applied hour markers, hands, and dual calendar window on the stainless steel men's quartz wrist watch";
    await prisma.productImage.update({ where: { id: close.id }, data: { fileName: newFile, altText: newAlt } });
    console.log(`Updated closeup ${close.id.slice(-8)}: ${newFile}`);
  } finally { await prisma.$disconnect(); }
})();
