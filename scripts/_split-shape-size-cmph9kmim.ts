/**
 * One-off: split the packed "Shape & Size" axis on product
 * cmph9kmim00hcw20getba50v7 into separate Shape + Size columns.
 *
 *   Before: ["Shape & Size", "Color"]
 *     option1 = "Round (8")"   option2 = "Black & White"
 *
 *   After:  ["Shape", "Size", "Color"]
 *     option1 = "Round"   option2 = "8 in"   option3 = "Black & White"
 *
 * Shopify allows up to 3 option axes per product, so whenever a packed axis
 * can be split cleanly we should split it.
 *
 *   npx tsx scripts/_split-shape-size-cmph9kmim.ts
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

const PRODUCT_ID = "cmph9kmim00hcw20getba50v7";

/** Parse e.g. `Round (8")` → { shape: "Round", size: '8"' }. */
function splitShapeSize(packed: string): { shape: string; size: string } | null {
  const m = packed.match(/^\s*(.+?)\s*\(\s*([^()]+?)\s*\)\s*$/);
  if (!m) return null;
  return { shape: m[1].trim(), size: m[2].trim() };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const product = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { id: true, title: true, optionNames: true },
    });
    if (!product) {
      console.error(`Product ${PRODUCT_ID} not found.`);
      process.exit(1);
    }
    console.log(`Product: ${product.title.slice(0, 80)}`);
    console.log(`optionNames (before): ${product.optionNames}`);

    const variants = await prisma.variant.findMany({
      where: { productId: PRODUCT_ID },
      orderBy: { position: "asc" },
    });
    console.log(`${variants.length} variants found`);

    // Validate: every variant's option1 must be parseable as "<shape> (<size>)".
    const planned = variants.map((v) => {
      const parsed = v.option1 ? splitShapeSize(v.option1) : null;
      return { variant: v, parsed };
    });
    const bad = planned.filter((p) => p.parsed === null);
    if (bad.length > 0) {
      console.error(`Cannot parse option1 for ${bad.length} variants:`);
      for (const b of bad) console.error(`  ${b.variant.id}: option1=${JSON.stringify(b.variant.option1)}`);
      process.exit(1);
    }

    console.log(`\nPlan:`);
    for (const p of planned) {
      const v = p.variant;
      const { shape, size } = p.parsed!;
      const color = v.option2 ?? "";
      console.log(
        `  #${v.position} id=${v.id}: "${v.option1}" / "${color}"  →  "${shape}" / "${size}" / "${color}"`,
      );
    }

    await prisma.$transaction([
      ...planned.map((p) => {
        const { shape, size } = p.parsed!;
        const color = p.variant.option2 ?? null;
        return prisma.variant.update({
          where: { id: p.variant.id },
          data: {
            option1: shape,
            option2: size,
            option3: color,
          },
        });
      }),
      prisma.product.update({
        where: { id: PRODUCT_ID },
        data: { optionNames: JSON.stringify(["Shape", "Size", "Color"]) },
      }),
    ]);

    console.log(`\nDone. Verifying...`);
    const after = await prisma.variant.findMany({
      where: { productId: PRODUCT_ID },
      orderBy: { position: "asc" },
    });
    for (const v of after) {
      console.log(
        `  #${v.position} ${v.isHidden ? "[HIDDEN] " : ""}option1="${v.option1}" option2="${v.option2}" option3="${v.option3}"`,
      );
    }
    const reloaded = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { optionNames: true },
    });
    console.log(`optionNames (after): ${reloaded?.optionNames}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
