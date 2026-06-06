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

const SUPABASE_PUBLIC = `${process.env.SUPABASE_URL}/storage/v1/object/public/product-images/`;

const prisma = new PrismaClient();
(async () => {
  const id = "cmpspbp9700gew24c1kfrcek7";
  const variants = await prisma.variant.findMany({
    where: { productId: id },
    orderBy: { position: "asc" },
  });
  for (const v of variants) {
    if (!v.featuredImageId) {
      console.log(`VAR pos=${v.position} ${v.title} — no featured image`);
      continue;
    }
    const img = await prisma.productImage.findUnique({ where: { id: v.featuredImageId } });
    if (!img?.storagePath) {
      console.log(`VAR pos=${v.position} ${v.title} — no storagePath`);
      continue;
    }
    console.log(`VAR pos=${v.position} ${v.title} → ${SUPABASE_PUBLIC}${img.storagePath}`);
  }
  console.log("");
  const sources = await prisma.productImage.findMany({
    where: { productId: id, imageType: null },
    orderBy: { position: "asc" },
    take: 6,
  });
  for (const s of sources) {
    if (!s.storagePath) continue;
    console.log(`SRC pos=${s.position} → ${SUPABASE_PUBLIC}${s.storagePath}`);
  }
  await prisma.$disconnect();
})();
