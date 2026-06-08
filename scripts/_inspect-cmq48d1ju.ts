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

const PID = "cmq48d1ju000jw2gowuwbmolt";

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
        tags: true,
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
          select: { id: true, position: true, imageType: true, variantId: true, sourceUrl: true, storagePath: true, keep: true },
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
    console.log(`OptionNames: ${JSON.stringify(product.optionNames)}`);
    console.log(`Tags: ${product.tags ?? "(null)"}`);
    console.log(`LifestyleUnitMode: ${product.lifestyleUnitMode ?? "(null)"}`);
    const descLen = product.descriptionHtml?.length ?? 0;
    console.log(`Description length: ${descLen} chars`);
    console.log("=".repeat(80));

    const visible = product.variants.filter((v) => !v.isHidden);
    console.log(`\nVARIANTS (${product.variants.length} total, ${visible.length} visible):`);
    for (const v of product.variants) {
      const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      const supplier = [v.supplierLabel1, v.supplierLabel2, v.supplierLabel3].filter(Boolean).join(" / ");
      console.log(`  #${v.position} [${v.id.slice(-8)}] ${v.title}  ${v.isHidden ? "*** HIDDEN ***" : ""}`);
      console.log(`     options: ${opts}`);
      if (supplier) console.log(`     supplier: ${supplier}`);
      console.log(`     fIMG=${v.featuredImageId?.slice(-8) ?? "—"}  cost=${v.supplierCost}  price=${v.price}  cAt=${v.compareAtPrice ?? "—"}`);
      if (v.packagingDimensions) console.log(`     packaging: ${v.packagingDimensions}`);
    }

    console.log(`\nIMAGES (${product.images.length}):`);
    const typeCount: Record<string, number> = {};
    for (const img of product.images) {
      const t = img.imageType ?? "(source)";
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    console.log(`  by type: ${JSON.stringify(typeCount)}`);
    const sourceImages = product.images.filter((i) => !i.imageType);
    const aliCount = sourceImages.filter((i) => (i.sourceUrl ?? "").includes("alicdn")).length;
    console.log(`  ${sourceImages.length} source images (no imageType), ${aliCount} from alicdn`);
    const starred = product.images.filter((i) => i.keep).length;
    console.log(`  ${starred} starred (keep=true)`);

    // Map variant -> featured image source url
    console.log(`\nVARIANT FEATURED IMAGE URLS:`);
    for (const v of product.variants) {
      if (!v.featuredImageId) { console.log(`  #${v.position}: (no featured image)`); continue; }
      const img = product.images.find((i) => i.id === v.featuredImageId);
      const url = img?.storagePath ? `[supabase] ${img.storagePath.slice(0, 60)}` : (img?.sourceUrl ?? "?").slice(0, 80);
      console.log(`  #${v.position} ${v.isHidden ? "(HID) " : ""}[${v.option1 ?? ""}|${v.option2 ?? ""}]: ${url}`);
    }

    console.log(`\nDESCRIPTION (full):`);
    console.log("-".repeat(80));
    console.log(product.descriptionHtml ?? "(none)");
    console.log("-".repeat(80));

    if (product.rawPayload) {
      try {
        const raw = JSON.parse(product.rawPayload) as Record<string, unknown>;
        const price = (raw as { price?: unknown }).price ?? null;
        if (price !== null) console.log(`\nRAW PAYLOAD price: ${JSON.stringify(price)}`);
        const rawTitle = (raw as { title?: unknown }).title ?? null;
        if (rawTitle) console.log(`RAW PAYLOAD title: ${rawTitle}`);
        const weight = (raw as { weight?: unknown }).weight ?? null;
        if (weight !== null) console.log(`RAW PAYLOAD weight: ${JSON.stringify(weight)}`);
      } catch (e) {
        console.log(`\n(rawPayload parse failed: ${e instanceof Error ? e.message : String(e)})`);
      }
    }
  } finally {
    await p.$disconnect();
  }
})();
