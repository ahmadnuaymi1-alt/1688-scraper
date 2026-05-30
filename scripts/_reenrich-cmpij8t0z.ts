/**
 * ONE-OFF: Re-run description enrichment for cmpij8t0z (whose phase-2 structuring
 * failed with a JSON parse error and silently fell back to the raw image-only
 * 1688 HTML). The structureCorpus function now retries on JSON parse failure,
 * so this fresh run should succeed.
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
    let v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PRODUCT_ID = "cmpij8t0z0169w2f073pwimv9";

async function main() {
  const { enrichDescription1688 } = await import(
    "../src/services/description-enrichment.service"
  );
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) { console.error("not found"); process.exit(1); }

  // Try to recover supplierAttributes from the existing productContext blob
  // (phase 1 persisted these; phase 2 may have overwritten with empties on
  //  the failed enrichment run).
  let supplierAttributes: Array<{ name: string; value: string }> | undefined;
  let supplierWeightG: number | undefined;
  try {
    const ctx = product.productContext ? JSON.parse(product.productContext) : null;
    if (ctx?.supplierAttributes && Array.isArray(ctx.supplierAttributes)) {
      supplierAttributes = ctx.supplierAttributes;
    }
    if (typeof ctx?.supplierWeightG === "number") {
      supplierWeightG = ctx.supplierWeightG;
    }
  } catch { /* ignore */ }

  // swatch image URLs from variant-linked downloaded ProductImages (tier-4 fallback)
  const swatchImageUrls = product.images
    .filter((i) => i.variantId !== null && i.downloadStatus === "downloaded")
    .map((i) => i.sourceUrl)
    .filter((u): u is string => !!u);

  console.log(`Re-enriching: ${product.title.slice(0, 60)}`);
  console.log(`  current descriptionHtml: ${product.descriptionHtml?.length ?? 0} chars`);
  console.log(`  supplierAttributes: ${supplierAttributes?.length ?? 0}`);
  console.log(`  supplierWeightG: ${supplierWeightG ?? "(none)"}`);
  console.log(`  swatch image URLs (tier-4 fallback): ${swatchImageUrls.length}`);
  console.log();

  // Build a minimal ScrapedProduct shape matching what scraper.service.ts builds.
  const scrapedShape = {
    title: product.title,
    handle: product.handle,
    productType: product.productType,
    descriptionHtml: product.descriptionHtml ?? "",
    metaDescription: null,
    vendor: null,
    tags: [],
    optionNames: product.optionNames ? JSON.parse(product.optionNames) : [],
    variants: [],
    images: [],
    rawPayload: null,
  } as never;

  const opts: Record<string, unknown> = {
    log: async (level: string, message: string) => {
      console.log(`  [${level}] ${message}`);
    },
  };
  if (supplierAttributes) opts.supplierAttributes = supplierAttributes;
  if (supplierWeightG !== undefined) opts.supplierWeightG = supplierWeightG;
  if (swatchImageUrls.length > 0) opts.swatchImageUrls = swatchImageUrls;

  const enriched = await enrichDescription1688(scrapedShape, opts as never);

  console.log();
  console.log(`Result:`);
  console.log(`  new descriptionHtml: ${enriched.descriptionHtml.length} chars`);
  console.log(`  specs: ${enriched.productContext.extractedSpecs.length}`);
  console.log(`  callouts: ${enriched.productContext.featureCallouts.length}`);
  console.log(`  angles: ${enriched.productContext.marketingAngles.length}`);
  console.log();
  console.log(`New HTML preview (first 400):`);
  console.log(enriched.descriptionHtml.slice(0, 400));
  console.log();

  await prisma.product.update({
    where: { id: PRODUCT_ID },
    data: {
      descriptionHtml: enriched.descriptionHtml,
      productContext: JSON.stringify(enriched.productContext),
    },
  });
  console.log(`Persisted to DB.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
