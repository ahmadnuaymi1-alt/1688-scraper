/**
 * Re-set 6 bad watch variants (rows 2,3,4,6,7,9) on cmpzixtaz00aow2hsqq59fqqx
 * back to their 1688 source so the bulk hero script can regen with the
 * sharpened anti-tag prompt. Rows 1,5,8 are left alone — user has approved.
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
const PID = "cmpzixtaz00aow2hsqq59fqqx";
const BAD_ROWS = new Set([2, 3, 4, 6, 7, 9]);
(async () => {
  const p = new PrismaClient();
  const variants = await p.variant.findMany({
    where: { productId: PID, isHidden: false },
    select: { id: true, title: true, position: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  const badVariants = variants.filter((v) => BAD_ROWS.has(v.position));
  console.log(`Found ${badVariants.length} bad variants to redo (rows ${[...BAD_ROWS].join(",")})`);

  for (const v of badVariants) {
    if (!v.featuredImageId) {
      console.log(`  row${v.position}  ${v.title} — no featuredImageId, skipping`);
      continue;
    }
    const currentImg = await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { id: true, imageType: true } });
    if (!currentImg || (currentImg.imageType !== "hero" && currentImg.imageType !== "hero-flat")) {
      console.log(`  row${v.position}  ${v.title} — featuredImageId already points to source (type=${currentImg?.imageType}), skipping`);
      continue;
    }
    // Find the original 1688 source: ProductImage with variantId=v.id AND imageType is NOT hero/hero-flat
    const src = await p.productImage.findFirst({
      where: {
        productId: PID,
        variantId: v.id,
        imageType: { notIn: ["hero", "hero-flat"] },
      },
      orderBy: { position: "asc" },
    });
    if (!src) {
      console.log(`  row${v.position}  ${v.title} — no 1688 source found via variantId backref, leaving as-is`);
      continue;
    }
    // Re-point featuredImageId → source, then delete the bad hero row
    await p.variant.update({ where: { id: v.id }, data: { featuredImageId: src.id } });
    await p.productImage.delete({ where: { id: currentImg.id } });
    console.log(`  row${v.position}  ${v.title}  →  re-pointed to source ${src.id.slice(0, 10)} (was hero ${currentImg.id.slice(0, 10)} — deleted)`);
  }

  // Print final state
  console.log("\nFinal state:");
  const after = await p.variant.findMany({ where: { productId: PID, isHidden: false }, select: { position: true, title: true, featuredImageId: true }, orderBy: { position: "asc" } });
  for (const v of after) {
    const img = v.featuredImageId ? await p.productImage.findUnique({ where: { id: v.featuredImageId }, select: { imageType: true } }) : null;
    console.log(`  row${v.position}  type=${img?.imageType ?? "—"}`);
  }
  await p.$disconnect();
})();
