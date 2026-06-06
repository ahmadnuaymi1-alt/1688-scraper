/**
 * Compute hero scope for a single product.
 * Read-only.
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
  const productId = "cmpxzjxge005lw260ntltwjdh";
  const prisma = new PrismaClient();
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true },
    });

    if (!product) {
      console.log(JSON.stringify({
        productExists: false,
        productTitle: null,
        visibleVariants: 0,
        uniqueVariantImageStoragePaths: 0,
        expectedHeroes: 0,
        currentHeroes: 0,
        needsWork: false,
      }, null, 2));
      return;
    }

    // Visible variants
    const visibleVariants = await prisma.variant.findMany({
      where: { productId, isHidden: false },
      select: { id: true, title: true, featuredImageId: true },
    });

    // Collect featuredImageIds (non-null)
    const featuredIds = visibleVariants
      .map((v) => v.featuredImageId)
      .filter((id): id is string => !!id);

    // Look up storagePaths
    const featuredImages = featuredIds.length
      ? await prisma.productImage.findMany({
          where: { id: { in: featuredIds } },
          select: { id: true, storagePath: true },
        })
      : [];

    const idToPath = new Map<string, string | null>();
    for (const fi of featuredImages) idToPath.set(fi.id, fi.storagePath);

    const uniquePaths = new Set<string>();
    for (const fid of featuredIds) {
      const p = idToPath.get(fid);
      if (p) uniquePaths.add(p);
    }

    // Existing hero-flat rows
    const heroFlatCount = await prisma.productImage.count({
      where: { productId, imageType: "hero-flat" },
    });

    const expectedHeroes = uniquePaths.size;
    const currentHeroes = heroFlatCount;
    const needsWork = expectedHeroes > currentHeroes;

    const out = {
      productExists: true,
      productTitle: product.title ?? "",
      visibleVariants: visibleVariants.length,
      uniqueVariantImageStoragePaths: uniquePaths.size,
      expectedHeroes,
      currentHeroes,
      needsWork,
    };

    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
