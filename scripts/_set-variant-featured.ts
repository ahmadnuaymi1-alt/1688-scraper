/**
 * Set a variant's featuredImageId.
 * Usage: npx tsx scripts/_set-variant-featured.ts <variantId> <imageId> [<variantId> <imageId> ...]
 *
 * Validates each imageId is a ProductImage belonging to the same product as
 * the variant before assigning.
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
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length % 2 !== 0) {
    console.error("Usage: npx tsx scripts/_set-variant-featured.ts <variantId> <imageId> [<variantId> <imageId> ...]");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    for (let i = 0; i < args.length; i += 2) {
      const variantId = args[i];
      const imageId = args[i + 1];
      const variant = await prisma.variant.findUnique({
        where: { id: variantId },
        select: { id: true, productId: true, title: true },
      });
      if (!variant) {
        console.error(`  SKIP — variant ${variantId} not found`);
        continue;
      }
      const img = await prisma.productImage.findUnique({
        where: { id: imageId },
        select: { id: true, productId: true, imageType: true, fileName: true },
      });
      if (!img) {
        console.error(`  SKIP — image ${imageId} not found`);
        continue;
      }
      if (img.productId !== variant.productId) {
        console.error(`  SKIP — image ${imageId} belongs to a different product`);
        continue;
      }
      await prisma.variant.update({
        where: { id: variantId },
        data: { featuredImageId: imageId },
      });
      console.log(
        `  SET variant ${variantId} (${variant.title.slice(0, 30)}) featuredImage → ${imageId} ` +
          `[type=${img.imageType ?? "null"}, ${img.fileName ?? "-"}]`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
