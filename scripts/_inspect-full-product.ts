/**
 * Full inspection of one product for a re-scrape task: source URL, variants
 * (live + hidden), optionNames, productContext specs, and a summary of
 * rawPayload (top-level keys + likely dimension/weight fields).
 *
 *   npx tsx scripts/_inspect-full-product.ts <productId>
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

async function main() {
  const productId = process.argv[2];
  if (!productId) { console.error("Usage: tsx scripts/_inspect-full-product.ts <productId>"); process.exit(1); }
  const prisma = new PrismaClient();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, title: true, optionNames: true, productContext: true, rawPayload: true,
      scrapeJob: { select: { sourceUrl: true } },
    },
  });
  if (!product) { console.error("Product not found:", productId); process.exit(1); }

  const variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: { id: true, option1: true, option2: true, option3: true, price: true, isHidden: true },
  });

  console.log("TITLE:", product.title);
  console.log("SOURCE URL:", product.scrapeJob?.sourceUrl ?? "(none)");
  console.log("optionNames:", product.optionNames);
  console.log("-".repeat(70));
  const live = variants.filter((v) => !v.isHidden);
  const hidden = variants.filter((v) => v.isHidden);
  console.log(`LIVE variants (${live.length}):`);
  for (const v of live) console.log(`  ${v.id}  [${v.option1 ?? ""}] [${v.option2 ?? ""}] [${v.option3 ?? ""}]  $${v.price}`);
  console.log(`HIDDEN variants (${hidden.length}):`);
  for (const v of hidden.slice(0, 12)) console.log(`  [${v.option1 ?? ""}] [${v.option2 ?? ""}]  $${v.price}`);
  if (hidden.length > 12) console.log(`  ... +${hidden.length - 12} more`);
  console.log("-".repeat(70));

  if (product.productContext) {
    try {
      const ctx = JSON.parse(product.productContext);
      console.log("productContext.supplierWeightG:", ctx.supplierWeightG);
      console.log(`extractedSpecs (${(ctx.extractedSpecs ?? []).length}):`);
      for (const s of ctx.extractedSpecs ?? []) console.log(`  - ${s.name}: ${s.value}`);
      console.log(`supplierAttributes (${(ctx.supplierAttributes ?? []).length}):`);
      for (const a of ctx.supplierAttributes ?? []) console.log(`  - ${a.name}: ${a.value}`);
    } catch (e) { console.log("productContext parse error:", e instanceof Error ? e.message : e); }
  } else console.log("productContext: (none)");
  console.log("-".repeat(70));

  if (product.rawPayload) {
    try {
      const rp = JSON.parse(product.rawPayload);
      console.log("rawPayload top-level keys:", Object.keys(rp).join(", "));
      console.log("rawPayload.productWeightG:", rp.productWeightG);
      console.log("rawPayload.price:", rp.price);
      // Surface any keys that look dimension/weight related
      for (const k of Object.keys(rp)) {
        if (/weight|dimension|size|width|height|depth|length|重量|尺寸/i.test(k)) {
          const val = typeof rp[k] === "object" ? JSON.stringify(rp[k]).slice(0, 300) : String(rp[k]).slice(0, 300);
          console.log(`  rawPayload.${k}: ${val}`);
        }
      }
      // featureAttributes (supplier attr table) often holds 尺寸/规格
      if (rp.featureAttributes) {
        console.log("rawPayload.featureAttributes:", JSON.stringify(rp.featureAttributes).slice(0, 800));
      }
      if (rp.skuProps || rp.skus) {
        console.log("rawPayload.skuProps:", JSON.stringify(rp.skuProps ?? rp.skus).slice(0, 800));
      }
    } catch (e) { console.log("rawPayload parse error:", e instanceof Error ? e.message : e); }
  } else console.log("rawPayload: (none)");

  await prisma.$disconnect();
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
