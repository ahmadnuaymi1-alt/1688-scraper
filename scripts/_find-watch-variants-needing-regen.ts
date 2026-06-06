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
const PID = "cmpzixtaz00aow2hsqq59fqqx";
(async () => {
  const p = new PrismaClient();
  const variants = await p.variant.findMany({
    where: { productId: PID, isHidden: false },
    select: { id: true, title: true, position: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  console.log(`${variants.length} visible variants for ${PID}:`);
  for (const v of variants) {
    const img = v.featuredImageId ? await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { imageType: true } }) : null;
    const tag = img?.imageType === "hero-flat" ? "✓ has hero" : (img?.imageType === null ? "→ NEEDS REGEN (points to 1688 source)" : "?");
    console.log(`  row${v.position}  ${v.title?.slice(0, 30).padEnd(30)}  feat=${v.featuredImageId?.slice(0, 12)}...  type=${img?.imageType ?? "—"}  ${tag}`);
  }
  // Orphan hero-flat rows for this product (no variant.featuredImageId points to them)
  const allHeroes = await p.productImage.findMany({ where: { productId: PID, imageType: "hero-flat" }, select: { id: true } });
  const usedIds = new Set(variants.map((v) => v.featuredImageId).filter(Boolean));
  const orphans = allHeroes.filter((h) => !usedIds.has(h.id));
  console.log(`\nOrphan hero-flat rows (no variant points to them): ${orphans.length}`);
  await p.$disconnect();
})();
