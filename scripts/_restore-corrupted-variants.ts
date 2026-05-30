/**
 * ONE-OFF: Restore variant axis values destroyed by an earlier Check 8 run
 * that incorrectly fell back to overwriting non-Size axes (Color, Finish,
 * Number Of Heads) with full-dim strings.
 *
 * Source of truth: variant.supplierLabel1 — preserved original Chinese supplier
 * labels for each variant. We map them back to clean English values per the
 * axis they belong to, plus re-derive variant.title from the option triple.
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

interface Fix {
  productId: string;
  axis: "option1" | "option2" | "option3";
  byPosition: Record<number, string>;
}

const FIXES: Fix[] = [
  // cmpjsvap8 — "Light Color" axis was on option1
  {
    productId: "cmpjsvap800iew2ggixwlxdbn",
    axis: "option1",
    byPosition: {
      0: "Black",
      1: "Red Antique",
      2: "Antique Bronze",
      4: "Rust",
      5: "Silver Gray",
      6: "Electroplated Silver",
      7: "Double Head Black",
      8: "Triple Head Black",
      9: "Four Head Black",
    },
  },
  // cmpjsug3l — "Finish" axis was on option1
  {
    productId: "cmpjsug3l00cpw2gg1r25v59u",
    axis: "option1",
    byPosition: {
      1: "Antique Bronze Left",
      2: "Antique Bronze Right",
      3: "Matte Black Left",
      4: "Matte Black Right",
    },
  },
  // cmpjstyid — "Number Of Heads" axis was on option2 (option1 = Color Temperature still intact)
  {
    productId: "cmpjstyid007tw2ggulv0g8b3",
    axis: "option2",
    byPosition: {
      1: "2-Head",
      2: "4-Head",
      3: "6-Head",
      4: "8-Head",
      5: "2-Head",
      6: "4-Head",
      7: "6-Head",
      8: "8-Head",
    },
  },
];

async function main() {
  const prisma = new PrismaClient();
  for (const fix of FIXES) {
    console.log(`\n=== ${fix.productId} — restoring ${fix.axis} ===`);
    const variants = await prisma.variant.findMany({
      where: { productId: fix.productId, isHidden: false },
      orderBy: { position: "asc" },
    });
    let updated = 0;
    let skipped = 0;
    for (const v of variants) {
      const newVal = fix.byPosition[v.position];
      if (!newVal) {
        console.log(`  pos=${v.position}: no mapping — skipping`);
        skipped++;
        continue;
      }
      const newOpt = { [fix.axis]: newVal };
      const o1 = fix.axis === "option1" ? newVal : v.option1;
      const o2 = fix.axis === "option2" ? newVal : v.option2;
      const o3 = fix.axis === "option3" ? newVal : v.option3;
      const newTitle =
        [o1, o2, o3]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" / ") || v.title;
      await prisma.variant.update({
        where: { id: v.id },
        data: { ...newOpt, title: newTitle },
      });
      console.log(`  pos=${v.position}: "${v[fix.axis]}" → "${newVal}"`);
      updated++;
    }
    console.log(`  → updated ${updated}, skipped ${skipped}`);
  }
  await prisma.$disconnect();
  console.log("\nDone.");
}
main().catch((e) => { console.error(e); process.exit(1); });
