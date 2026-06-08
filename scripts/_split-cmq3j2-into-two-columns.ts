/**
 * Split product cmq3j2npf003iw2p8qf2wm9nl's single "Color" axis into TWO:
 *  - Dial   — White, Blue, Black, Bronze, Green, Light Green, Light Blue,
 *             Silver, Teal, "Blue (White Sub-Dials)", "Light Green (Black Sub-Dials)"
 *  - Strap  — Brown Leather, Black Leather, Steel Bracelet, Blue Leather
 *
 * Derived from Gemini Vision's per-variant proposals; pos 23 ("Watch Box And
 * Bag") is a packaging accessory and gets re-hidden — NOT a real variant.
 *
 * Run with --apply to write; default is dry-run.
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
const PID = "cmq3j2npf003iw2p8qf2wm9nl";
const APPLY = process.argv.includes("--apply");

// pos → [dial, strap, isAccessory]
const MAPPING: Record<number, [string, string, boolean]> = {
  1: ["White", "Brown Leather", false],
  2: ["Blue", "Brown Leather", false],
  3: ["Black", "Black Leather", false],
  4: ["Bronze", "Black Leather", false],
  5: ["Green", "Black Leather", false],
  6: ["Light Green", "Brown Leather", false],
  7: ["Blue", "Black Leather", false],
  8: ["Light Blue", "Black Leather", false],
  9: ["Silver", "Black Leather", false],
  10: ["Blue", "Steel Bracelet", false],
  11: ["Light Green", "Steel Bracelet", false],
  12: ["Green", "Steel Bracelet", false],
  13: ["Black", "Steel Bracelet", false],
  14: ["Blue (White Sub-Dials)", "Steel Bracelet", false],
  15: ["White", "Steel Bracelet", false],
  16: ["Light Blue", "Steel Bracelet", false],
  17: ["Bronze", "Steel Bracelet", false],
  18: ["Silver", "Steel Bracelet", false],
  19: ["Teal", "Brown Leather", false],
  20: ["White", "Blue Leather", false],
  21: ["Light Green (Black Sub-Dials)", "Steel Bracelet", false],
  22: ["Light Green (Black Sub-Dials)", "Black Leather", false],
  23: ["", "", true], // Watch Box And Bag — accessory, re-hide
};

(async () => {
  const p = new PrismaClient();
  const variants = await p.variant.findMany({
    where: { productId: PID },
    select: { id: true, position: true, title: true, option1: true, option2: true },
    orderBy: { position: "asc" },
  });

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Variants found: ${variants.length}\n`);

  // Update Product.optionNames first
  if (APPLY) {
    await p.product.update({ where: { id: PID }, data: { optionNames: JSON.stringify(["Dial", "Strap"]) } });
    console.log(`✓ Product.optionNames → ["Dial", "Strap"]`);
  } else {
    console.log(`(dry) Would set Product.optionNames → ["Dial", "Strap"]`);
  }

  for (const v of variants) {
    const m = MAPPING[v.position];
    if (!m) {
      console.log(`  pos${v.position}  NO MAPPING — skip`);
      continue;
    }
    const [dial, strap, isAccessory] = m;
    if (isAccessory) {
      console.log(`  pos${v.position}  ACCESSORY (Watch Box & Bag) — re-hide`);
      if (APPLY) await p.variant.update({ where: { id: v.id }, data: { isHidden: true } });
      continue;
    }
    const newTitle = `${dial} / ${strap}`;
    console.log(`  pos${String(v.position).padStart(2, " ")}  title="${v.title}"  →  opt1="${dial}"  opt2="${strap}"  title="${newTitle}"`);
    if (APPLY) {
      await p.variant.update({
        where: { id: v.id },
        data: { option1: dial, option2: strap, option3: null, title: newTitle, isHidden: false },
      });
    }
  }
  console.log(`\n${APPLY ? "Applied." : "Dry-run done. Re-run with --apply to write."}`);
  await p.$disconnect();
})();
