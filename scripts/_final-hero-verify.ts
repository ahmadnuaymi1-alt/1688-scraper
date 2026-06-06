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
const IDS = [
  "cmpvdwok500frw2hk9nmld4k0","cmpvdvyra00dbw2hktxto64m0","cmpvdvrbu00atw2hk09s9sds6",
  "cmpvdv330000jtzr0x291djgp","cmpvdv27r008sw2hk94xcdomh","cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes","cmpvdueu50047w2hktmugaati","cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];
(async () => {
  const p = new PrismaClient();
  let okCount = 0, mismatchCount = 0;
  for (const id of IDS) {
    const variants = await p.variant.findMany({
      where: { productId: id, isHidden: false },
      select: { id: true, featuredImageId: true },
    });
    const featIds = variants.map((v) => v.featuredImageId).filter((x): x is string => !!x);
    const featImgs = featIds.length ? await p.productImage.findMany({ where: { id: { in: featIds } }, select: { storagePath: true } }) : [];
    const uniqueFeaturedStoragePaths = new Set(featImgs.map((i) => i.storagePath).filter(Boolean));
    const expected = uniqueFeaturedStoragePaths.size;
    const heroRows = await p.productImage.count({ where: { productId: id, imageType: "hero-flat" } });
    const ok = heroRows >= expected;
    const status = ok ? "✓" : "✗";
    if (ok) okCount++; else mismatchCount++;
    console.log(`  ${status} ${id}  variants=${variants.length}  uniqueVariantImages=${expected}  heroFlatRows=${heroRows}`);
  }
  console.log(`\n${okCount}/${IDS.length} products at full hero coverage.`);
  if (mismatchCount > 0) console.log(`${mismatchCount} still short.`);
  await p.$disconnect();
})();
