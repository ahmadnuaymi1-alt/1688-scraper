/** Print variant image URLs for cmq3ybrqm000jw25g2h0dyzbp so we can compare opaque duplicates */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

(async () => {
  const p = new PrismaClient();
  try {
    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: {
        position: true, option1: true, isHidden: true,
        featuredImage: { select: { sourceUrl: true, storagePath: true } },
      },
    });
    for (const v of variants) {
      let imgUrl = v.featuredImage?.sourceUrl ?? "";
      if (v.featuredImage?.storagePath && SUPABASE_URL) {
        imgUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${v.featuredImage.storagePath}`;
      }
      console.log(`#${String(v.position).padStart(2)} hidden=${v.isHidden ? "Y" : " "} ${v.option1}`);
      console.log(`    ${imgUrl}`);
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
