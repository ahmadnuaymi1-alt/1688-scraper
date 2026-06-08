/**
 * Apply variant fixes for cmq3yck9q000jw2q03468fge7:
 * - Set Product.productType = "watch"
 * - Single variant: since there's only ONE variant, set option1 to "Default Title" (Shopify convention)
 *   and Product.optionNames to ["Title"]. This avoids exposing a meaningless single-choice picker.
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

const PID = "cmq3yck9q000jw2q03468fge7";

async function main() {
  const prisma = new PrismaClient();
  const before = await prisma.product.findUnique({
    where: { id: PID },
    select: { productType: true, optionNames: true },
  });
  console.log("BEFORE product:", JSON.stringify(before));
  const variantsBefore = await prisma.variant.findMany({
    where: { productId: PID },
    select: { id: true, option1: true, option2: true, option3: true },
  });
  console.log("BEFORE variants:", JSON.stringify(variantsBefore));

  // Update product: set productType to "watch", optionNames to ["Title"]
  await prisma.product.update({
    where: { id: PID },
    data: { productType: "watch", optionNames: JSON.stringify(["Title"]) },
  });

  // Update the single variant's option1 to "Default Title"
  for (const v of variantsBefore) {
    await prisma.variant.update({
      where: { id: v.id },
      data: { option1: "Default Title", option2: null, option3: null },
    });
  }

  const after = await prisma.product.findUnique({
    where: { id: PID },
    select: { productType: true, optionNames: true },
  });
  console.log("\nAFTER product:", JSON.stringify(after));
  const variantsAfter = await prisma.variant.findMany({
    where: { productId: PID },
    select: { id: true, option1: true, option2: true, option3: true },
  });
  console.log("AFTER variants:", JSON.stringify(variantsAfter));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
