/**
 * Agent-mode Step 1 apply — variant intelligence on cmq48d1ju000jw2gowuwbmolt
 * (Stainless Steel Round Quartz Dual Calendar Men's Watch).
 *
 * Decisions (from direct image inspection + Gemini Vision, recorded in conversation):
 *   - productType was null  -> set "watch"
 *   - optionNames stays ["Style"] (single axis): the 5 distinct combos do NOT form a
 *     clean Dial x Band grid (gaps would create invalid picker combos = MORE confusing),
 *     so one clear descriptive Style axis is "easiest for the customer to understand".
 *   - NOT a pack-axis false positive: all 6 came in visible, no values looked numeric.
 *   - True duplicate: #6 == #2 (black case / black starry-sky dial / black mesh band).
 *     Keep #2 (lower position), hide #6.
 *   - Clean customer-facing names replace the messy reordered-Chinese translations.
 *
 * Sequential DB writes (connection_limit=1).
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

const PID = "cmq48d1ju000jw2gowuwbmolt";

// position -> { name, hide }
const PLAN: Record<number, { name: string; hide: boolean }> = {
  1: { name: "Blue Starry Sky Dial / Mesh Band", hide: false },
  2: { name: "Black Starry Sky Dial / Mesh Band", hide: false },
  3: { name: "Black Dial / Steel Bracelet", hide: false },
  4: { name: "Blue Starry Sky Dial / Steel Bracelet", hide: false },
  5: { name: "Blue Sunburst Dial / Steel Bracelet", hide: false },
  6: { name: "Black Starry Sky Dial / Mesh Band", hide: true }, // DUP of #2
};

(async () => {
  const prisma = new PrismaClient();
  try {
    // productType + optionNames
    console.log("Updating Product.productType + optionNames...");
    await prisma.product.update({
      where: { id: PID },
      data: { productType: "watch", optionNames: JSON.stringify(["Style"]) },
    });
    console.log("  productType='watch', optionNames=[Style]");

    const variants = await prisma.variant.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    console.log("\nApplying variant renames (sequential)...");
    for (const v of variants) {
      const plan = PLAN[v.position];
      if (!plan) { console.log(`  #${v.position}: no plan entry, skipping`); continue; }
      await prisma.variant.update({
        where: { id: v.id },
        data: {
          title: plan.name,
          option1: plan.name,
          option2: null,
          option3: null,
          isHidden: plan.hide,
        },
      });
      console.log(`  #${v.position}  ${plan.hide ? "HIDE " : "show "} -> "${plan.name}"`);
    }

    console.log("\nFinal variant state:");
    const after = await prisma.variant.findMany({
      where: { productId: PID }, orderBy: { position: "asc" },
      select: { position: true, title: true, option1: true, isHidden: true },
    });
    const visible = after.filter((x) => !x.isHidden);
    console.log(`  ${visible.length} visible / ${after.length} total`);
    for (const v of after) {
      console.log(`  #${v.position}  ${v.isHidden ? "HIDE" : "show"}  ${v.option1}`);
    }
    const prod = await prisma.product.findUnique({ where: { id: PID }, select: { productType: true, optionNames: true } });
    console.log(`\n  productType=${prod?.productType}  optionNames=${prod?.optionNames}`);
  } finally {
    await prisma.$disconnect();
  }
})();
