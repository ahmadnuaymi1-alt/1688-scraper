/**
 * Inspect cmq489vf3000jw2dolzoxx5ks (jewelry box) — variants, images, productType, description.
 * Read-only.
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

const PID = "cmq489vf3000jw2dolzoxx5ks";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

function pubUrl(storagePath: string | null | undefined, sourceUrl: string | null | undefined): string {
  if (storagePath && SUPABASE_URL) return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${storagePath}`;
  return sourceUrl ?? "";
}

(async () => {
  const p = new PrismaClient();
  try {
    const prod = await p.product.findUnique({
      where: { id: PID },
      select: {
        id: true, title: true, productType: true, optionNames: true,
        tags: true, metaDescription: true,
        descriptionHtml: true, rawPayload: true,
      },
    });
    if (!prod) { console.log("PRODUCT NOT FOUND"); return; }
    console.log("=== PRODUCT ===");
    console.log("id:", prod.id);
    console.log("title:", prod.title);
    console.log("productType:", JSON.stringify(prod.productType));
    console.log("optionNames:", JSON.stringify(prod.optionNames));
    console.log("tags:", JSON.stringify(prod.tags));
    console.log("metaDescription:", JSON.stringify(prod.metaDescription));
    const desc = prod.descriptionHtml ?? "";
    console.log("descriptionHtml length:", desc.length);
    // rawPayload price for pricing methodology
    try {
      const rp = JSON.parse(prod.rawPayload ?? "{}");
      const price = rp?.price ?? rp?.data?.price ?? rp?.offer?.price;
      console.log("rawPayload.price:", JSON.stringify(price));
    } catch { /* ignore */ }

    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: {
        id: true, position: true, title: true, option1: true, option2: true, option3: true,
        isHidden: true, price: true, compareAtPrice: true, sku: true,
        weight: true, weightUnit: true, packagingDimensions: true,
        supplierLabel1: true, supplierLabel2: true,
        featuredImageId: true,
        featuredImage: { select: { id: true, sourceUrl: true, storagePath: true } },
      },
    });
    console.log(`\n=== VARIANTS (${variants.length}) ===`);
    for (const v of variants) {
      console.log(
        `#${String(v.position).padStart(2)} ${v.isHidden ? "[HIDDEN]" : "[visible]"} o1=${JSON.stringify(v.option1)} o2=${JSON.stringify(v.option2)} title=${JSON.stringify(v.title)} price=${v.price} wt=${v.weight}${v.weightUnit ?? ""} pkgDim=${JSON.stringify(v.packagingDimensions)} featImg=${v.featuredImageId ? v.featuredImageId.slice(-6) : "NONE"}`,
      );
      if (v.featuredImage) console.log(`        featImgUrl: ${pubUrl(v.featuredImage.storagePath, v.featuredImage.sourceUrl).slice(0, 130)}`);
    }
    const visible = variants.filter((v) => !v.isHidden);
    console.log(`\nvisible=${visible.length} hidden=${variants.length - visible.length}`);

    const images = await p.productImage.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { id: true, position: true, imageType: true, keep: true, sourceUrl: true, storagePath: true },
    });
    console.log(`\n=== IMAGES (${images.length}) ===`);
    const byType = new Map<string, number>();
    for (const im of images) {
      const t = im.imageType ?? "(null/original)";
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    for (const [t, n] of byType.entries()) console.log(`  ${n}× ${t}`);
    console.log("\nfirst 30 images:");
    for (const im of images.slice(0, 30)) {
      const host = (() => { try { return new URL(im.sourceUrl ?? "").host; } catch { return "?"; } })();
      console.log(`  #${String(im.position).padStart(2)} type=${(im.imageType ?? "null").padEnd(18)} keep=${im.keep} host=${host}`);
    }

    console.log("\n=== FULL DESCRIPTION ===");
    console.log(desc);
    console.log("\n=== ALL IMAGE URLS ===");
    for (const im of images) {
      console.log(`#${String(im.position).padStart(2)} ${pubUrl(im.storagePath, im.sourceUrl)}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
