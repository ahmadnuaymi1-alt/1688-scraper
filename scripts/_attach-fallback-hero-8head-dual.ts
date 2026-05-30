/**
 * ONE-OFF: the Dual Color / 8-Head variant of cmpjstyid007tw2ggulv0g8b3
 * fails Higgsfield content-moderation consistently. Its shape/housing is
 * identical to the Warm White / 8-Head variant (which succeeded). Attach the
 * Warm White / 8-Head hero-flat to the Dual Color / 8-Head variant so all
 * eight variants have a hero on the review page.
 *
 * Specifically:
 *   1. Find the Dual Color / 8-Head variant.
 *   2. Find the Warm White / 8-Head variant's hero-flat ProductImage.
 *   3. Create a NEW ProductImage row for the Dual Color variant that points
 *      at the same storagePath / sourceUrl as the Warm White hero, with
 *      imageType="hero-flat", variantId=<dualColor 8-Head variant id>.
 *   4. Set that variant's featuredImageId.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PRODUCT_ID = "cmpjstyid007tw2ggulv0g8b3";
const prisma = new PrismaClient();

function isEightHead(title: string | null): boolean {
  if (!title) return false;
  return /8[\s-]?head/i.test(title);
}
function isDualColor(title: string | null): boolean {
  if (!title) return false;
  return /dual\s*color/i.test(title);
}
function isWarmWhite(title: string | null): boolean {
  if (!title) return false;
  return /warm\s*white/i.test(title);
}

(async () => {
  const variants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID },
    select: { id: true, title: true, position: true, featuredImageId: true, isHidden: true },
    orderBy: { position: "asc" },
  });

  const dualColor8 = variants.find((v) => !v.isHidden && isEightHead(v.title) && isDualColor(v.title));
  const warmWhite8 = variants.find((v) => !v.isHidden && isEightHead(v.title) && isWarmWhite(v.title));
  if (!dualColor8) {
    console.error("Could not find Dual Color / 8-Head variant. Variants:");
    for (const v of variants) console.error(`  ${v.position}  ${v.title}`);
    process.exit(1);
  }
  if (!warmWhite8) {
    console.error("Could not find Warm White / 8-Head variant. Variants:");
    for (const v of variants) console.error(`  ${v.position}  ${v.title}`);
    process.exit(1);
  }
  console.log(`Target variant (missing hero): ${dualColor8.id} "${dualColor8.title}" pos=${dualColor8.position}`);
  console.log(`Source variant (has hero):    ${warmWhite8.id} "${warmWhite8.title}" pos=${warmWhite8.position}`);

  if (dualColor8.featuredImageId) {
    const existing = await prisma.productImage.findUnique({
      where: { id: dualColor8.featuredImageId },
      select: { id: true, imageType: true, storagePath: true },
    });
    if (existing && (existing.imageType === "hero" || existing.imageType === "hero-flat")) {
      console.log(`Dual Color 8-Head already has hero ${existing.id} (${existing.imageType}). No-op.`);
      await prisma.$disconnect();
      return;
    }
  }

  const sourceHero = await prisma.productImage.findFirst({
    where: {
      productId: PRODUCT_ID,
      variantId: warmWhite8.id,
      imageType: { in: ["hero", "hero-flat"] },
    },
    orderBy: { position: "desc" },
  });
  if (!sourceHero) {
    console.error(`Warm White 8-Head variant has no hero ProductImage. Cannot fall back.`);
    process.exit(1);
  }
  console.log(`Source hero: ${sourceHero.id} type=${sourceHero.imageType} path=${sourceHero.storagePath}`);

  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId: PRODUCT_ID },
    _max: { position: true },
  });
  const nextPos = (maxPosRow._max.position ?? 0) + 1;

  const created = await prisma.productImage.create({
    data: {
      productId: PRODUCT_ID,
      variantId: dualColor8.id,
      sourceUrl: sourceHero.sourceUrl,
      storagePath: sourceHero.storagePath,
      fileName: sourceHero.fileName,
      position: nextPos,
      downloadStatus: "downloaded",
      imageType: "hero-flat",
    },
  });
  console.log(`Created ProductImage ${created.id} (position ${nextPos}) for Dual Color 8-Head`);

  await prisma.variant.update({
    where: { id: dualColor8.id },
    data: { featuredImageId: created.id },
  });
  console.log(`Set variant.featuredImageId = ${created.id} for Dual Color 8-Head`);

  console.log(`Done.`);
  await prisma.$disconnect();
})();
