/**
 * One-off: split the packed axis on product cmph9kvuf00muw20gqmtk0bc0 from
 * one labeled axis ("Size & Power") where shape+size+power are all packed
 * into option1, into three clean Shopify axes: Shape | Size | Power.
 *
 *   Before: optionNames = ["Size & Power"]
 *     option1 = "Round (16"), Warm White 48W"   option2 = null   option3 = null
 *
 *   After:  optionNames = ["Shape", "Size", "Power"]
 *     option1 = "Round"  option2 = "16""  option3 = "Warm White 48W"
 *
 *   npx tsx scripts/_split-size-power-cmph9kvuf.ts
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

const PRODUCT_ID = "cmph9kvuf00muw20gqmtk0bc0";

/**
 * Parse a fully packed option1 like
 *   `Round (16"), Warm White 48W`
 *   `Square (20" × 20"), Tri-Color 2×48W`
 *   `Rectangle (41" × 26"), Dimmable 2×120W`
 * into { shape, size, power }.
 */
function splitShapeSizePower(
  packed: string,
): { shape: string; size: string; power: string } | null {
  // Match "<shape> (<size>), <power>" — size may contain its own parens? no,
  // size is "16\"" or "20\" × 20\"" — never parens inside. shape is one word.
  const m = packed.match(/^\s*(.+?)\s*\(\s*([^()]+?)\s*\)\s*,\s*(.+?)\s*$/);
  if (!m) return null;
  return { shape: m[1].trim(), size: m[2].trim(), power: m[3].trim() };
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

    const planned = variants.map((v) => {
      const parsed = v.option1 ? splitShapeSizePower(v.option1) : null;
      return { variant: v, parsed };
    });
    const bad = planned.filter((p) => p.parsed === null);
    if (bad.length > 0) {
      console.error(`Cannot parse option1 as "<shape> (<size>), <power>" for ${bad.length} variants:`);
      for (const b of bad) console.error(`  ${b.variant.id}: option1=${JSON.stringify(b.variant.option1)}`);
      process.exit(1);
    }

    console.log(`\nPlan:`);
    for (const p of planned) {
      const v = p.variant;
      const { shape, size, power } = p.parsed!;
      console.log(
        `  #${v.position} id=${v.id}: "${v.option1}"  →  "${shape}" / "${size}" / "${power}"`,
      );
    }

    await prisma.$transaction([
      ...planned.map((p) => {
        const { shape, size, power } = p.parsed!;
        return prisma.variant.update({
          where: { id: p.variant.id },
          data: {
            option1: shape,
            option2: size,
            option3: power,
          },
        });
      }),
      prisma.product.update({
        where: { id: PRODUCT_ID },
        data: { optionNames: JSON.stringify(["Shape", "Size", "Power"]) },
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
