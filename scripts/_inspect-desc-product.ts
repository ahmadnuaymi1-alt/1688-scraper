/**
 * Inspect ONE product's description-relevant data so we can diagnose why the
 * Specifications section is messy: dumps live vs hidden variants, optionNames,
 * the parsed productContext (extractedSpecs / featureCallouts / weight), and
 * the current descriptionHtml.
 *
 *   npx tsx scripts/_inspect-desc-product.ts <productId>
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
  if (!productId) { console.error("Usage: tsx scripts/_inspect-desc-product.ts <productId>"); process.exit(1); }
  const prisma = new PrismaClient();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, optionNames: true, descriptionHtml: true, productContext: true },
  });
  if (!product) { console.error("Product not found:", productId); process.exit(1); }

  const variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: { option1: true, option2: true, option3: true, price: true, isHidden: true },
  });
  const live = variants.filter((v) => !v.isHidden);
  const hidden = variants.filter((v) => v.isHidden);

  console.log("=".repeat(70));
  console.log("TITLE:", product.title);
  console.log("optionNames:", product.optionNames);
  console.log("-".repeat(70));
  console.log(`LIVE variants (${live.length}):`);
  for (const v of live) {
    console.log(`  [${v.option1 ?? ""}] [${v.option2 ?? ""}] [${v.option3 ?? ""}]  $${v.price}`);
  }
  console.log(`HIDDEN variants (${hidden.length}):`);
  for (const v of hidden) {
    console.log(`  [${v.option1 ?? ""}] [${v.option2 ?? ""}] [${v.option3 ?? ""}]  $${v.price}`);
  }
  console.log("-".repeat(70));

  if (product.productContext) {
    try {
      const ctx = JSON.parse(product.productContext);
      console.log("productContext.supplierWeightG:", ctx.supplierWeightG);
      console.log(`extractedSpecs (${(ctx.extractedSpecs ?? []).length}):`);
      for (const s of ctx.extractedSpecs ?? []) console.log(`  - ${s.name}: ${s.value}`);
      console.log(`featureCallouts (${(ctx.featureCallouts ?? []).length}):`);
      for (const f of ctx.featureCallouts ?? []) console.log(`  - ${f}`);
      console.log(`supplierAttributes (${(ctx.supplierAttributes ?? []).length}):`);
      for (const a of ctx.supplierAttributes ?? []) console.log(`  - ${a.name}: ${a.value}`);
    } catch (e) {
      console.log("productContext parse error:", e instanceof Error ? e.message : e);
    }
  } else {
    console.log("productContext: (none)");
  }
  console.log("=".repeat(70));
  console.log("CURRENT descriptionHtml:");
  console.log(product.descriptionHtml ?? "(none)");
  console.log("=".repeat(70));

  await prisma.$disconnect();
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
