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
const IDS = ["cmpwtf8ds00inw29ghs56kiq8","cmpwsr41400dtw28cxispu8c8","cmpwtdpb5005uw29gk3uft7k8","cmpwsp4ar007fw28chis8tnk8","cmpwsph9v00adw28csba3rrwy","cmpwtev6z00gbw29gpe4rxq0r","cmpwsowix005rw28cx6mwp3t3","cmpwsol0y002rw28cii3g4ja6","cmpwte53l00bhw29gm0ue8mvq"];
(async () => {
  const p = new PrismaClient();
  let totalNeeded = 0, totalHave = 0;
  for (const id of IDS) {
    const variants = await p.variant.findMany({ where: { productId: id, isHidden: false }, select: { featuredImageId: true } });
    const featIds = variants.map((v) => v.featuredImageId).filter((x): x is string => !!x);
    const featImgs = featIds.length ? await p.productImage.findMany({ where: { id: { in: featIds } }, select: { storagePath: true } }) : [];
    const need = new Set(featImgs.map((i) => i.storagePath).filter(Boolean)).size;
    const have = await p.productImage.count({ where: { productId: id, imageType: "hero-flat" } });
    const gap = Math.max(0, need - have);
    totalNeeded += gap;
    totalHave += have;
    console.log(`  ${id}  have=${have}  need=${need}  gap=${gap}`);
  }
  console.log(`\nTotal heroes already present: ${totalHave}`);
  console.log(`Total heroes still to generate: ${totalNeeded}`);
  await p.$disconnect();
})();
