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
  for (const id of ["cmpvdueu50047w2hktmugaati","cmpvduv67007jw2hknhvxnqwe"]) {
    console.log(`\n=== ${id} ===`);
    const variants = await p.variant.findMany({ where: { productId: id, isHidden: false }, select: { id: true, title: true, featuredImageId: true, position: true }, orderBy: { position: "asc" } });
    for (const v of variants) {
      const feat = v.featuredImageId ? await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { storagePath: true, imageType: true } }) : null;
      const directLink = await p.productImage.findFirst({ where: { productId: id, variantId: v.id, imageType: { notIn: ["hero", "hero-flat"] } }, select: { storagePath: true } });
      console.log(`  pos${v.position}: ${v.title?.slice(0, 50)}`);
      console.log(`    featuredImageId → ${v.featuredImageId} (${feat?.imageType}, storage=${feat?.storagePath?.slice(-50)})`);
      console.log(`    direct ProductImage.variantId match → storage=${directLink?.storagePath?.slice(-50) ?? "none"}`);
    }
  }
  await p.$disconnect();
})();
