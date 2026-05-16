/**
 * Non-destructive probe for the variant-curator Path B (axis restructuring).
 *
 * Loads the live (non-hidden) variants of a real product, feeds them through
 * `autoCurateVariants` (Stage A + Stage B Claude call), and logs the result.
 * Does NOT write to the DB — pure dry-run.
 *
 * Cost: 1 Claude Haiku 4.5 call (~$0.003).
 *
 * Env: PRODUCT_ID (cuid).
 *
 * The probe PASSES if Stage B picks Path B (restructure with newOptionNames),
 * because the reading-lamp test product is a textbook case for splitting.
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

const PRODUCT_ID = process.env.PRODUCT_ID;
if (!PRODUCT_ID) {
  console.error("Set PRODUCT_ID env var");
  process.exit(1);
}

async function main() {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    console.error(`Product ${PRODUCT_ID} not found`);
    process.exit(1);
  }

  console.log(`Product: ${product.title.slice(0, 80)}`);
  console.log(`Live variants: ${product.variants.length}`);
  const optionNames: string[] = (() => {
    if (!product.optionNames) return [];
    try {
      const arr = JSON.parse(product.optionNames);
      return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  })();
  console.log(`Source option axes: ${JSON.stringify(optionNames)}`);

  // Show a sample of packed values so we can see what the LLM is working with.
  const sample = product.variants.slice(0, 5);
  console.log("\nSample variants (first 5):");
  for (const v of sample) {
    console.log(`  ${v.option1 || "-"} | ${v.option2 || "-"} | ${v.option3 || "-"}`);
  }

  console.log("\nCalling autoCurateVariants...");
  // Dynamic import so the env vars are already loaded.
  const { autoCurateVariants } = await import("../src/services/variant-curation.service.js");
  const scrapedShape = product.variants.map((v) => ({
    title: v.title,
    option1: v.option1 ?? undefined,
    option2: v.option2 ?? undefined,
    option3: v.option3 ?? undefined,
    price: v.price,
    compareAtPrice: v.compareAtPrice ?? undefined,
    supplierCost: v.supplierCost ?? undefined,
    sku: v.sku ?? undefined,
    barcode: v.barcode ?? undefined,
    weight: v.weight ?? undefined,
    weightUnit: (v.weightUnit ?? undefined) as "g" | "kg" | "lb" | "oz" | undefined,
    packagingDimensions: v.packagingDimensions ?? undefined,
    position: v.position,
    sourceVariantId: v.sourceVariantId ?? undefined,
    supplierLabel1: v.supplierLabel1 ?? undefined,
    supplierLabel2: v.supplierLabel2 ?? undefined,
    supplierLabel3: v.supplierLabel3 ?? undefined,
  }));
  const result = await autoCurateVariants(scrapedShape, product.title, optionNames);

  console.log("\n=== RESULT ===");
  console.log(`New optionNames: ${JSON.stringify(result.optionNames)}`);
  console.log(`Kept: ${result.kept.length}  Dropped: ${result.dropped.length}  Renamed: ${result.renamed.length}`);
  console.log("\nKept variants (after restructure):");
  for (const v of result.kept.slice(0, 12)) {
    const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
    console.log(`  ${opts}`);
  }
  if (result.kept.length > 12) console.log(`  ... and ${result.kept.length - 12} more`);

  // Heuristic check: did the restructure produce > source axis count?
  const srcAxisCount = optionNames.filter((n) => n && n.trim()).length;
  const newAxisCount = result.optionNames.length;
  if (newAxisCount > srcAxisCount) {
    console.log(`\n✓ PATH B fired — went from ${srcAxisCount} axis/axes → ${newAxisCount}`);
  } else {
    console.log(`\n• PATH A — kept ${srcAxisCount} axis structure`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
