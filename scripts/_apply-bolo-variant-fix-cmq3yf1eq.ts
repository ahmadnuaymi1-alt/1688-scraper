/**
 * Apply variant intelligence fix for bolo tie product cmq3yf1eq000jw2kcemhuhsp9.
 *
 * Vision pass on 6 variant images revealed:
 *   - 2 axes: Stone color × Hardware finish (cord matches finish)
 *   - All same braided cord + same scroll-bezel slide + same teardrop tips
 *
 * Mapping (verified by direct image inspection 2026-06-07):
 *   pos=1 Color 1 → Stone=Turquoise   Finish=Aged Brass / Brown Cord
 *   pos=2 Color 2 → Stone=Black Onyx  Finish=Aged Brass / Brown Cord
 *   pos=3 Color 3 → Stone=Amber       Finish=Aged Brass / Brown Cord
 *   pos=4 Color 4 → Stone=Turquoise   Finish=Antique Silver / Black Cord
 *   pos=5 Color 5 → Stone=Black Onyx  Finish=Antique Silver / Black Cord
 *   pos=6 Color 6 → Stone=Amber       Finish=Antique Silver / Black Cord
 *
 * Also:
 *   - Set Product.productType="bolo-tie"
 *   - Set Product.optionNames=["Stone","Finish"]
 *   - Fix Product.title from "Necklace" to "Bolo Tie"
 *   - All 6 visible, none hidden — each is genuinely distinct.
 * Sequential writes (connection_limit=1).
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

const PID = "cmq3yf1eq000jw2kcemhuhsp9";

interface Mapping {
  position: number;
  stone: string;
  finish: string;
}

const MAP: Mapping[] = [
  { position: 1, stone: "Turquoise", finish: "Aged Brass" },
  { position: 2, stone: "Black Onyx", finish: "Aged Brass" },
  { position: 3, stone: "Amber", finish: "Aged Brass" },
  { position: 4, stone: "Turquoise", finish: "Antique Silver" },
  { position: 5, stone: "Black Onyx", finish: "Antique Silver" },
  { position: 6, stone: "Amber", finish: "Antique Silver" },
];

async function main() {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: { id: true, title: true, optionNames: true, productType: true },
    });
    if (!product) throw new Error("product not found");
    console.log("Before:", { title: product.title, optionNames: product.optionNames, productType: product.productType });

    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { id: true, position: true, option1: true, option2: true, sku: true, title: true },
    });
    console.log(`Found ${variants.length} variants`);

    for (const v of variants) {
      const m = MAP.find((x) => x.position === v.position);
      if (!m) {
        console.log(`  pos=${v.position} — NO MAPPING, skipping`);
        continue;
      }
      const newTitle = `${m.stone} / ${m.finish}`;
      await p.variant.update({
        where: { id: v.id },
        data: {
          option1: m.stone,
          option2: m.finish,
          option3: null,
          title: newTitle,
          isHidden: false,
        },
      });
      console.log(`  pos=${v.position}: ${v.option1} → ${m.stone} / ${m.finish}`);
    }

    // Build a clearer English title — "Western Bolo Tie with Cabochon Stone in Scroll Bezel"
    const newProductTitle = "Vintage Western Bolo Tie with Oval Cabochon Stone";
    await p.product.update({
      where: { id: PID },
      data: {
        optionNames: JSON.stringify(["Stone", "Finish"]),
        productType: "bolo-tie",
        title: newProductTitle,
      },
    });

    const after = await p.product.findUnique({
      where: { id: PID },
      select: {
        title: true,
        optionNames: true,
        productType: true,
        variants: {
          orderBy: { position: "asc" },
          select: { position: true, option1: true, option2: true, title: true, isHidden: true },
        },
      },
    });
    console.log("\nAfter:");
    console.log("  title:", after?.title);
    console.log("  optionNames:", after?.optionNames);
    console.log("  productType:", after?.productType);
    for (const v of after?.variants ?? []) {
      console.log(`  pos=${v.position} hidden=${v.isHidden} opt1=${v.option1} opt2=${v.option2} title=${v.title}`);
    }
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
