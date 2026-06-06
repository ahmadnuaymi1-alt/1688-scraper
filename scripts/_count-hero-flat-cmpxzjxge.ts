/**
 * Count hero-flat ProductImage rows for product cmpxzjxge005lw260ntltwjdh.
 *   npx tsx scripts/_count-hero-flat-cmpxzjxge.ts
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
  const prisma = new PrismaClient();
  const productId = "cmpxzjxge005lw260ntltwjdh";

  const heroes = await prisma.productImage.findMany({
    where: { productId, imageType: "hero-flat" },
    select: { id: true, variantId: true, storagePath: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  process.stdout.write(`hero-flat count for ${productId}: ${heroes.length}\n`);
  for (const h of heroes) {
    process.stdout.write(`  - id=${h.id} variantId=${h.variantId ?? "null"} storagePath=${h.storagePath ?? "null"}\n`);
  }

  // Also list variants with their featuredImageId, to understand the expected groups
  const variants = await prisma.variant.findMany({
    where: { productId },
    select: { id: true, optionsJson: true, featuredImageId: true },
  });
  process.stdout.write(`\nvariants: ${variants.length}\n`);
  const featuredIds = new Set<string>();
  for (const v of variants) {
    if (v.featuredImageId) featuredIds.add(v.featuredImageId);
  }
  process.stdout.write(`unique featured image ids across variants: ${featuredIds.size}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
