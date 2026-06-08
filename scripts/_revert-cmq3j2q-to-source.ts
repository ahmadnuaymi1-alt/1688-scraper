/**
 * Revert all 11 variants of cmq3j2qot004dw2p89csu44b3 from their bad heroes
 * back to their 1688 source images, deleting the bad hero ProductImage rows
 * so the bulk hero script sees them as un-served and regens with the new
 * Hybrid-C prompt.
 */
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
const PID = "cmq3j2qot004dw2p89csu44b3";
(async () => {
  const p = new PrismaClient();
  const variants = await p.variant.findMany({
    where: { productId: PID, isHidden: false },
    select: { id: true, title: true, position: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  console.log(`Reverting ${variants.length} variants of ${PID}\n`);
  let reverted = 0;
  for (const v of variants) {
    if (!v.featuredImageId) {
      console.log(`  pos${v.position}  no featuredImageId, skip`);
      continue;
    }
    const cur = await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { id: true, imageType: true } });
    if (!cur || (cur.imageType !== "hero" && cur.imageType !== "hero-flat")) {
      console.log(`  pos${v.position}  already on source (type=${cur?.imageType}), skip`);
      continue;
    }
    const src = await p.productImage.findFirst({
      where: {
        productId: PID,
        variantId: v.id,
        OR: [{ imageType: null }, { imageType: { notIn: ["hero", "hero-flat"] } }],
      },
      orderBy: { position: "asc" },
    });
    if (!src) {
      console.log(`  pos${v.position}  no source found via variantId backref, leaving as-is`);
      continue;
    }
    await p.variant.update({ where: { id: v.id }, data: { featuredImageId: src.id } });
    await p.productImage.delete({ where: { id: cur.id } });
    reverted++;
    console.log(`  pos${v.position}  ${v.title}  →  source ${src.id.slice(0, 10)} (deleted hero ${cur.id.slice(0, 10)})`);
  }
  console.log(`\nReverted ${reverted}/${variants.length}`);
  await p.$disconnect();
})();
