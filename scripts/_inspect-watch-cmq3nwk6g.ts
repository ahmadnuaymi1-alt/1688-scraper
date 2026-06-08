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

const PID = "cmq3nwk6g000jw2hst5cwxfj8";

(async () => {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: {
        id: true,
        title: true,
        productType: true,
        descriptionHtml: true,
        lifestyleUnitMode: true,
        optionNames: true,
        rawPayload: true,
        variants: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            title: true,
            option1: true, option2: true, option3: true,
            supplierLabel1: true, supplierLabel2: true, supplierLabel3: true,
            featuredImageId: true,
            isHidden: true,
            packagingDimensions: true,
            supplierCost: true,
            price: true,
            compareAtPrice: true,
          },
        },
        images: {
          orderBy: { position: "asc" },
          select: { id: true, position: true, imageType: true, variantId: true, sourceUrl: true, storagePath: true },
        },
      },
    });
    if (!product) {
      console.log(`Product ${PID} not found`);
      process.exit(1);
    }
    console.log("=".repeat(80));
    console.log(`PRODUCT: ${product.id}`);
    console.log(`Title: ${product.title}`);
    console.log(`ProductType: ${product.productType ?? "(null)"}`);
    console.log(`OptionNames: ${product.optionNames ?? "(null)"}`);
    console.log(`LifestyleUnitMode: ${product.lifestyleUnitMode ?? "(null)"}`);
    const descLen = product.descriptionHtml?.length ?? 0;
    console.log(`Description length: ${descLen} chars`);
    console.log("=".repeat(80));

    console.log(`\nVARIANTS (${product.variants.length}):`);
    for (const v of product.variants) {
      const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      const supplier = [v.supplierLabel1, v.supplierLabel2, v.supplierLabel3].filter(Boolean).join(" / ");
      console.log(`  #${v.position} [${v.id.slice(-8)}] ${v.title}`);
      console.log(`     options: ${opts}`);
      if (supplier) console.log(`     supplier: ${supplier}`);
      console.log(`     hidden=${v.isHidden}  fIMG=${v.featuredImageId?.slice(-8) ?? "—"}  cost=${v.supplierCost}  price=${v.price}  cAt=${v.compareAtPrice ?? "—"}`);
      if (v.packagingDimensions) {
        console.log(`     packaging: ${v.packagingDimensions}`);
      }
    }

    console.log(`\nIMAGES (${product.images.length}):`);
    const typeCount: Record<string, number> = {};
    for (const img of product.images) {
      const t = img.imageType ?? "(source)";
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    console.log(`  by type: ${JSON.stringify(typeCount)}`);
    const sourceImages = product.images.filter((i) => !i.imageType);
    console.log(`  ${sourceImages.length} source images (no imageType)`);
    const variantSrcCount: Record<string, number> = {};
    for (const img of sourceImages) {
      const key = img.variantId ?? "(unlinked)";
      variantSrcCount[key] = (variantSrcCount[key] ?? 0) + 1;
    }
    const unlinkedSrc = variantSrcCount["(unlinked)"] ?? 0;
    console.log(`  ${unlinkedSrc} source images NOT linked to any variant (general gallery)`);
    console.log(`  ${Object.keys(variantSrcCount).filter((k) => k !== "(unlinked)").length} variants with source images attached`);

    console.log(`\nDESCRIPTION (first 1500 chars):`);
    console.log("─".repeat(80));
    console.log((product.descriptionHtml ?? "").slice(0, 1500));
    console.log("─".repeat(80));

    if (product.rawPayload) {
      try {
        const raw = JSON.parse(product.rawPayload) as Record<string, unknown>;
        const rawDims = (raw as { dimensions?: unknown; specs?: unknown }).dimensions ?? (raw as { specs?: unknown }).specs ?? null;
        if (rawDims) {
          console.log(`\nRAW PAYLOAD dimensions/specs (first 1500 chars):`);
          console.log(JSON.stringify(rawDims, null, 2).slice(0, 1500));
        }
        const price = (raw as { price?: unknown }).price ?? null;
        if (price !== null) console.log(`\nRAW PAYLOAD price: ${JSON.stringify(price)}`);
        const rawTitle = (raw as { title?: unknown }).title ?? null;
        if (rawTitle) console.log(`RAW PAYLOAD title: ${rawTitle}`);
      } catch (e) {
        console.log(`\n(rawPayload parse failed: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
  } finally {
    await p.$disconnect();
  }
})();
