/**
 * One-off: collapse cmph9lrjg00uzw20g20efzh0c (linear strip light) from
 * Length × Light Color (30 variants) to Length-only (6 variants).
 *
 *  - Keeps the Warm White (暖光) row for each of the 6 source lengths.
 *  - Fixes a prior rename bug where customer-facing option1 lengths were
 *    alphabetically misaligned with the supplier-actual lengths.
 *  - Deletes every other variant (visible + hidden).
 *  - Updates product.optionNames to ["Length"].
 *
 *   npx tsx scripts/_curate-cmph9lrjg.ts
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

const PRODUCT_ID = "cmph9lrjg00uzw20g20efzh0c";

function parseLengthCm(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.match(/(\d+)\s*cm/i);
  return m ? parseInt(m[1], 10) : null;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const variants = await prisma.variant.findMany({
      where: { productId: PRODUCT_ID },
      orderBy: { position: "asc" },
    });

    // Warm White = 暖光 in the supplier's option2 label. These are the keepers.
    const warm = variants.filter((v) => (v.supplierLabel2 ?? "").includes("暖光"));
    if (warm.length !== 6) {
      console.error(`Expected 6 warm-white (暖光) variants, found ${warm.length}. Aborting.`);
      process.exit(1);
    }

    const keepers = warm
      .map((v) => ({ id: v.id, lengthCm: parseLengthCm(v.supplierLabel1) }))
      .filter((x): x is { id: string; lengthCm: number } => x.lengthCm !== null)
      .sort((a, b) => a.lengthCm - b.lengthCm);

    if (keepers.length !== 6) {
      console.error(`Could not parse all 6 warm-white supplier lengths. Aborting.`);
      process.exit(1);
    }

    const keeperIds = new Set(keepers.map((k) => k.id));
    const dropIds = variants.filter((v) => !keeperIds.has(v.id)).map((v) => v.id);

    console.log(`Plan:`);
    console.log(`  Keep 6 (warm white, one per length, length-sorted):`);
    keepers.forEach((k, i) => console.log(`    pos ${i}: ${k.lengthCm} cm`));
    console.log(`  Delete ${dropIds.length} other variants.`);
    console.log(`  Update product.optionNames -> ["Length"].`);

    await prisma.$transaction([
      ...keepers.map((k, i) =>
        prisma.variant.update({
          where: { id: k.id },
          data: {
            option1: `${k.lengthCm} cm`,
            option2: null,
            title: `${k.lengthCm} cm`,
            position: i,
            isHidden: false,
          },
        }),
      ),
      prisma.variant.deleteMany({ where: { id: { in: dropIds } } }),
      prisma.product.update({
        where: { id: PRODUCT_ID },
        data: { optionNames: JSON.stringify(["Length"]) },
      }),
    ]);

    console.log(`\nDone. Verifying...`);
    const after = await prisma.variant.findMany({
      where: { productId: PRODUCT_ID },
      orderBy: { position: "asc" },
    });
    console.log(`${after.length} variants remain:`);
    for (const v of after) {
      console.log(
        `  pos ${v.position}: option1="${v.option1}" option2=${v.option2 === null ? "null" : `"${v.option2}"`} title="${v.title}"`,
      );
    }
    const product = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { optionNames: true },
    });
    console.log(`optionNames: ${product?.optionNames}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
