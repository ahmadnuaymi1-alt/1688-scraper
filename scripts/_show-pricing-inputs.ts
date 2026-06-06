/**
 * Read-only: print everything the NEW pricing mindset would consider for
 * one product. Does NOT call Claude or modify the DB.
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

const PRODUCT_ID = process.argv[2];
if (!PRODUCT_ID) { console.error("usage: tsx _show-pricing-inputs.ts <productId>"); process.exit(1); }

(async () => {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      id: true, title: true, productType: true, descriptionHtml: true, productContext: true, rawPayload: true,
      variants: { orderBy: { position: "asc" }, select: { position: true, title: true, price: true, supplierCost: true, weight: true, weightUnit: true } },
      images: { take: 6, orderBy: { position: "asc" }, select: { sourceUrl: true, altText: true, imageType: true, storagePath: true } },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }

  console.log(`\n=== ${p.id} ===`);
  console.log(`Title: ${p.title}`);
  console.log(`Type: ${p.productType ?? "(none)"}`);

  // Raw 1688 price block — true wholesale + currency.
  const raw = JSON.parse(p.rawPayload);
  console.log(`\n[RAW 1688 PRICE BLOCK]`);
  console.log(`  price: ${JSON.stringify(raw.price)}`);
  console.log(`  productWeightG: ${raw.productWeightG}`);
  console.log(`  supplier: ${raw.supplier?.companyName ?? raw.supplier?.loginId ?? "?"}`);

  console.log(`\n[VARIANTS in DB] (${p.variants.length})`);
  for (const v of p.variants.slice(0, 6)) {
    console.log(`  pos${v.position} ${(v.title ?? "").slice(0, 50).padEnd(50)} price=$${v.price} supplierCost=${v.supplierCost ? "$" + v.supplierCost : "(none)"} weight=${v.weight ?? "?"} ${v.weightUnit ?? ""}`);
  }
  if (p.variants.length > 6) console.log(`  … +${p.variants.length - 6} more`);

  console.log(`\n[IMAGES — first 6 source URLs]`);
  for (const img of p.images) {
    console.log(`  ${img.imageType ?? "(src)"} ${img.altText?.slice(0, 30) ?? ""}`);
    console.log(`    ${img.sourceUrl}`);
  }

  // productContext — the cached audit understanding
  const ctx = p.productContext ? JSON.parse(p.productContext) : null;
  if (ctx) {
    console.log(`\n[productContext.marketingAngles]`);
    for (const a of (ctx.marketingAngles ?? []).slice(0, 8)) console.log(`  - ${a}`);
    console.log(`\n[productContext.featureCallouts]`);
    for (const c of (ctx.featureCallouts ?? []).slice(0, 8)) console.log(`  - ${c}`);
    console.log(`\n[productContext.extractedSpecs] (${(ctx.extractedSpecs ?? []).length})`);
    for (const s of (ctx.extractedSpecs ?? []).slice(0, 25)) console.log(`  ${s.name}: ${s.value}`);
  }

  await prisma.$disconnect();
})();
