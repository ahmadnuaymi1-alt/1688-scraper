/**
 * ONE-OFF: cmpjswsmv00rfw2ggb4z2n7tb currently has 2 visible variants —
 * "Square / Black" and "Square / White" — on a Shape × Color axis. The
 * user asked to add "Circle / Black" and "Circle / White" variants too.
 *
 * Mirrors the existing variants' price + pkg dimensions; leaves
 * featuredImageId null so the next hero run pulls a reasonable source via
 * the audit's Check 2 (or the bulk-heroes script's variantId-link logic).
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

const PRODUCT_ID = "cmpjswsmv00rfw2ggb4z2n7tb";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: { variants: { orderBy: { position: "asc" } } },
  });
  if (!p) { console.error("product not found"); process.exit(1); }

  // Check for existing Circle variants — idempotent skip if already added.
  const existing = p.variants.filter((v) => v.option1?.toLowerCase() === "circle");
  if (existing.length > 0) {
    console.log(`Circle variants already exist (${existing.length}). Skipping.`);
    process.exit(0);
  }

  // Use the Square variants as a template for price, weight, pkg dims.
  const square = p.variants.find((v) => v.option1?.toLowerCase() === "square" && !v.isHidden);
  if (!square) {
    console.error("No Square template variant found. Aborting.");
    process.exit(1);
  }

  const maxPos = p.variants.reduce((m, v) => Math.max(m, v.position), -1);
  const newVariants = [
    { color: "Black", position: maxPos + 1 },
    { color: "White", position: maxPos + 2 },
  ];

  console.log(`Template variant: pos=${square.position} title="${square.title}" price=${square.price}`);
  console.log(`Adding ${newVariants.length} new Circle variants...`);

  for (const nv of newVariants) {
    const newTitle = `Circle / ${nv.color}`;
    await prisma.variant.create({
      data: {
        productId: PRODUCT_ID,
        title: newTitle,
        option1: "Circle",
        option2: nv.color,
        option3: null,
        price: square.price,
        compareAtPrice: square.compareAtPrice,
        supplierCost: square.supplierCost,
        sku: null,
        barcode: null,
        weight: square.weight,
        weightUnit: square.weightUnit,
        packagingDimensions: square.packagingDimensions,
        position: nv.position,
        sourceVariantId: null,
        supplierLabel1: "Circle",
        supplierLabel2: nv.color,
        supplierLabel3: null,
        featuredImageId: null,
      },
    });
    console.log(`  ✓ ${newTitle} (pos ${nv.position})`);
  }

  console.log(`Done. Re-load /review/${PRODUCT_ID} to verify.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
