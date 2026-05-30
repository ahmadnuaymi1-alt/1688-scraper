/**
 * ONE-OFF: cmpigpnld00t5w2f0za0e7qgt has 1 variant with featuredImageId=null
 * and 5 source images all with variantId=null. The hero pipeline requires
 * featuredImageId OR variantId-linked image, so it skips with "no source
 * image". Set the variant's featuredImageId to the position-0 source image
 * (and stamp variantId on that image for the secondary fallback).
 *
 * Safe to delete after running.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PRODUCT_ID = "cmpigpnld00t5w2f0za0e7qgt";

async function main() {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    console.error("Product not found");
    process.exit(1);
  }
  const variant = product.variants[0];
  if (!variant) {
    console.error("No variants");
    process.exit(1);
  }
  // Pick the position-0 source image (excluding any heroes/lifestyles).
  const sourceImg = product.images.find(
    (i) => i.imageType !== "hero" && i.imageType !== "hero-flat" && i.imageType !== "lifestyle",
  );
  if (!sourceImg) {
    console.error("No source image found");
    process.exit(1);
  }
  console.log(`Linking variant ${variant.id} ("${variant.title}") → image ${sourceImg.id} (pos ${sourceImg.position})`);

  await prisma.$transaction([
    prisma.variant.update({
      where: { id: variant.id },
      data: { featuredImageId: sourceImg.id },
    }),
    prisma.productImage.update({
      where: { id: sourceImg.id },
      data: { variantId: variant.id },
    }),
  ]);

  const after = await prisma.variant.findUnique({ where: { id: variant.id } });
  console.log(`Done. featuredImageId now: ${after?.featuredImageId}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
