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
  console.log(`Per-product hero-flat with orphan / multi-variant counts:\n`);
  for (const id of IDS) {
    const imgs = await p.productImage.findMany({
      where: { productId: id, imageType: "hero-flat" },
      select: { id: true, variantId: true, sourceUrl: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const orphans = imgs.filter((i) => !i.variantId);
    const attached = imgs.filter((i) => i.variantId);
    const uniqueAttachedSourceUrls = new Set(attached.map((i) => i.sourceUrl));
    const uniqueOrphanSourceUrls = new Set(orphans.map((i) => i.sourceUrl));
    console.log(`  ${id}  total=${imgs.length}  orphan(productId-only,no variantId)=${orphans.length}  attached=${attached.length}  uniqueAttachedUrls=${uniqueAttachedSourceUrls.size}  uniqueOrphanUrls=${uniqueOrphanSourceUrls.size}`);
    if (orphans.length > 0) {
      console.log(`    sample orphan url: ${(orphans[0].sourceUrl ?? "").slice(0, 70)}`);
    }
  }
  await p.$disconnect();
})();
