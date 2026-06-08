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
  const p = new PrismaClient();
  try {
    const imgs = await p.productImage.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { id: true, position: true, imageType: true, variantId: true, sourceUrl: true, storagePath: true, keep: true },
    });
    console.log(`IMAGES (${imgs.length}):`);
    for (const i of imgs) {
      console.log(`  pos=${i.position} type=${i.imageType ?? "(null)"} vId=${i.variantId?.slice(-8) ?? "-"} id=${i.id.slice(-8)} sp=${(i.storagePath ?? "").slice(0, 50)} src=${(i.sourceUrl ?? "").slice(0, 50)}`);
    }
    const vs = await p.variant.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { position: true, option1: true, isHidden: true, featuredImageId: true,
        featuredImage: { select: { id: true, imageType: true, storagePath: true, sourceUrl: true } } },
    });
    console.log(`\nVARIANTS:`);
    for (const v of vs) {
      const fi = v.featuredImage;
      const exists = fi ? "EXISTS" : "DANGLING/NULL";
      console.log(`  #${v.position} ${v.isHidden ? "(HID)" : ""} ${v.option1}`);
      console.log(`     featuredImageId=${v.featuredImageId?.slice(-8) ?? "null"} -> ${exists}  type=${fi?.imageType ?? "-"}  sp=${(fi?.storagePath ?? "").slice(0, 50)}`);
    }
  } finally { await p.$disconnect(); }
})();
