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
(async () => {
  const p = new PrismaClient();
  const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";
  const vs = await p.variant.findMany({
    where: { productId: "cmq48d1ju000jw2gowuwbmolt" }, orderBy: { position: "asc" },
    select: { position: true, option1: true, featuredImage: { select: { storagePath: true, sourceUrl: true } } },
  });
  for (const v of vs) {
    let u = v.featuredImage?.sourceUrl ?? "";
    if (v.featuredImage?.storagePath && SUPA) u = `${SUPA}/storage/v1/object/public/${BUCKET}/${v.featuredImage.storagePath}`;
    console.log(`#${v.position}\t${u}`);
  }
  await p.$disconnect();
})();
