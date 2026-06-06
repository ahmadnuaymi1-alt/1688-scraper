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
(async () => {
  const p = new PrismaClient();
  const id = "cmpvdu7sd002zw2hkznd00mrj";
  const all = await p.productImage.findMany({ where: { productId: id }, select: { id: true, imageType: true, variantId: true, position: true, storagePath: true }, orderBy: { position: "asc" } });
  console.log(`All ProductImage rows for ${id}:`);
  for (const r of all) {
    console.log(`  pos${String(r.position).padStart(3)} type=${(r.imageType ?? "null").padEnd(10)} variantId=${r.variantId ?? "null"} storage=${r.storagePath?.slice(-50)}`);
  }
  const variants = await p.variant.findMany({ where: { productId: id }, select: { id: true, title: true, featuredImageId: true, isHidden: true }, orderBy: { position: "asc" } });
  console.log(`\nVariants:`);
  for (const v of variants) {
    console.log(`  ${v.id} hidden=${v.isHidden} featuredImageId=${v.featuredImageId} title=${v.title?.slice(0,40)}`);
  }
  await p.$disconnect();
})();
