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

const PRODUCT_ID = "cmq3yck9q000jw2q03468fge7";

async function main() {
  const prisma = new PrismaClient();

  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      id: true,
      title: true,
      productType: true,
      handle: true,
      vendor: true,
      tags: true,
    },
  });
  console.log("PRODUCT:", JSON.stringify(product, null, 2));

  const variants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID },
    select: {
      id: true,
      position: true,
      option1: true,
      option2: true,
      option3: true,
      sku: true,
      price: true,
      compareAtPrice: true,
      supplierCost: true,
      packagingDimensions: true,
      isHidden: true,
      featuredImageId: true,
    },
    orderBy: { position: "asc" },
  });
  console.log(`\nVARIANTS (${variants.length} total):`);
  for (const v of variants) {
    console.log(
      `#${v.position} ${v.isHidden ? "[HIDDEN]" : "        "} opt1=${JSON.stringify(v.option1)} opt2=${JSON.stringify(v.option2)} opt3=${JSON.stringify(v.option3)} sku=${v.sku} price=${v.price} cost=${v.supplierCost} pkgDims=${JSON.stringify(v.packagingDimensions)}`,
    );
  }

  // Show featured image URL for each
  console.log("\nFEATURED IMAGES PER VARIANT:");
  for (const v of variants) {
    if (!v.featuredImageId) {
      console.log(`#${v.position} no featuredImageId`);
      continue;
    }
    const pi = await prisma.productImage.findUnique({
      where: { id: v.featuredImageId },
      select: { storagePath: true, sourceUrl: true, fileName: true },
    });
    console.log(
      `#${v.position} ${v.isHidden ? "H" : " "} feat ${pi?.storagePath ?? pi?.sourceUrl ?? "(missing)"}`,
    );
  }

  const visibleCount = variants.filter((v) => !v.isHidden).length;
  const hiddenCount = variants.filter((v) => v.isHidden).length;
  console.log(`\nVisible: ${visibleCount}, Hidden: ${hiddenCount}`);

  // Show all images for this product
  const images = await prisma.productImage.findMany({
    where: { productId: PRODUCT_ID },
    select: {
      id: true,
      storagePath: true,
      sourceUrl: true,
      imageType: true,
      keep: true,
      position: true,
    },
    orderBy: { position: "asc" },
  });
  console.log(`\nALL IMAGES (${images.length}):`);
  for (const img of images) {
    console.log(`  #${img.position} type=${img.imageType ?? "null"} keep=${img.keep} ${img.storagePath ?? img.sourceUrl ?? "(missing)"}`);
  }

  // Show raw payload variant info
  const raw = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { rawPayload: true },
  });
  const rp: any = raw?.rawPayload;
  if (rp) {
    console.log("\nRAW PAYLOAD KEYS:", Object.keys(rp).join(", "));
    if (rp.variants) console.log("\nrawPayload.variants count:", rp.variants.length);
    if (rp.skuInfos) console.log("\nrawPayload.skuInfos count:", rp.skuInfos.length);
    if (rp.skus) console.log("\nrawPayload.skus count:", rp.skus.length);
    if (rp.productAttribute) console.log("productAttribute:", rp.productAttribute);
    if (rp.price) console.log("price:", rp.price);
    if (rp.priceInfo) console.log("priceInfo:", JSON.stringify(rp.priceInfo).slice(0, 400));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
