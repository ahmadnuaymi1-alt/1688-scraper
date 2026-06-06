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
const IDS = ["cmpvdwok500frw2hk9nmld4k0","cmpvduv67007jw2hknhvxnqwe","cmpvdueu50047w2hktmugaati","cmpvdu7sd002zw2hkznd00mrj"];
(async () => {
  const p = new PrismaClient();
  for (const id of IDS) {
    const variants = await p.variant.findMany({
      where: { productId: id, isHidden: false },
      select: { id: true, title: true, featuredImageId: true },
      orderBy: { position: "asc" },
    });
    const featIds = variants.map((v) => v.featuredImageId).filter((x): x is string => !!x);
    const featImgs = featIds.length ? await p.productImage.findMany({ where: { id: { in: featIds } }, select: { id: true, storagePath: true } }) : [];
    const uniqueStorage = new Set(featImgs.map((i) => i.storagePath).filter(Boolean));
    const heroFlats = await p.productImage.findMany({ where: { productId: id, imageType: "hero-flat" }, select: { id: true, storagePath: true } });
    const heroStorage = new Set(heroFlats.map((h) => h.storagePath).filter(Boolean));
    const variantsServed = variants.filter((v) => v.featuredImageId && heroFlats.some((h) => h.id === v.featuredImageId)).length;
    console.log(`${id}`);
    console.log(`  variants=${variants.length}  withFeaturedId=${featIds.length}  uniqueFeaturedStorage=${uniqueStorage.size}`);
    console.log(`  heroFlatRows=${heroFlats.length}  uniqueHeroStorage=${heroStorage.size}  variantsServedViaFeatured=${variantsServed}`);
    const variantPathsSet = new Set(featImgs.map((i) => i.storagePath));
    const heroPathsSet = new Set(heroFlats.map((h) => h.storagePath));
    const missing = [...variantPathsSet].filter((s) => !heroPathsSet.has(s));
    console.log(`  missingHeroes=${missing.length}`);
    for (const m of missing.slice(0, 5)) console.log(`    - ${m?.slice(-80)}`);
  }
  await p.$disconnect();
})();
