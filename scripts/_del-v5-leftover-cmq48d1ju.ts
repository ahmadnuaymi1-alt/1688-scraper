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
    // Delete only the leftover null-type recovery source row (no variant currently
    // references it as featured — all 5 visible variants point to hero-flat rows).
    const del = await p.productImage.deleteMany({
      where: { productId: PID, imageType: null, keep: false },
    });
    console.log(`Deleted ${del.count} leftover null-type source row(s).`);
    const remaining = await p.productImage.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { position: true, imageType: true, variantId: true },
    });
    console.log(`Remaining images (${remaining.length}):`);
    for (const r of remaining) console.log(`  pos=${r.position} type=${r.imageType ?? "(null)"} v=${r.variantId?.slice(-8) ?? "-"}`);
  } finally { await p.$disconnect(); }
})();
