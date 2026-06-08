/**
 * Agent-mode STEP 1 variant intelligence for cmq48d6pa000jw2fw81cyt2gy.
 *
 * This product is actually a WESTERN BOLO TIE set (braided leather cord +
 * cast-metal decorative slide + aglet tips), scraped under a "necklace" title.
 * Supplier crossed 9 slide designs × metal finish (silver/bronze) × 3 cord
 * colours (black / dark brown / light brown) = 51 SKUs.
 *
 * Decision (anchor: "easiest for the customer to understand", luxury curation):
 *  - Single "Style" axis. Fold metal finish into the design name.
 *  - Collapse the cord-colour axis to BLACK (the universal western cord; shown
 *    in every clean reference). Hide the 34 brown-cord SKUs.
 *  - That leaves 17 genuinely-distinct design+finish SKUs (Style 1 bronze-only,
 *    Styles 2-9 in antique silver + antique bronze), all on black cord.
 *  - Rename each survivor to a descriptive western name.
 *  - Set productType="necklace" (was null).
 *
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq48d6pa000jw2fw81cyt2gy";

/** Map current option1 (English) -> customer-facing Style name. Black-cord SKUs only kept. */
const KEEP: Record<string, string> = {
  "Style 1 - Black leather": "Cowboy Hat — Antique Brass",
  "Style 2 - Antique silver, black leather": "Longhorn Skull — Antique Silver",
  "Style 2 - Antique bronze, black leather": "Longhorn Skull — Antique Brass",
  "Style 3 - Antique silver, black leather": "Steer-Skull Concho — Antique Silver",
  "Style 3 - Antique bronze, black leather": "Steer-Skull Concho — Antique Brass",
  "Style 4 - Antique silver, black leather": "Texas Star — Antique Silver",
  "Style 4 - Antique bronze, black leather": "Texas Star — Antique Brass",
  "Style 5 - Antique silver, black leather": "Floral Rosette Concho — Antique Silver",
  "Style 5 - Antique bronze, black leather": "Floral Rosette Concho — Antique Brass",
  "Style 6 - Antique silver, black leather": "Cowboy Hat Concho — Antique Silver",
  "Style 6 - Antique bronze, black leather": "Cowboy Hat Concho — Antique Brass",
  "Style 7 - Antique silver, black leather": "Spread-Wing Eagle — Antique Silver",
  "Style 7 - Antique bronze, black leather": "Spread-Wing Eagle — Antique Brass",
  "Style 8 - Antique silver, black leather": "Bison Skull — Antique Silver",
  "Style 8 - Antique bronze, black leather": "Bison Skull — Antique Brass",
  "Style 9 - Antique silver, black leather": "Dished Cowboy Hat — Antique Silver",
  "Style 9 - Antique bronze, black leather": "Dished Cowboy Hat — Antique Brass",
};

async function main() {
  const prisma = new PrismaClient();

  // 1) productType
  await prisma.product.update({
    where: { id: PID },
    data: { productType: "necklace", optionNames: JSON.stringify(["Style"]) },
  });
  console.log('set productType="necklace", optionNames=["Style"]');

  const variants = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { id: true, position: true, option1: true, isHidden: true },
  });

  let kept = 0;
  let hidden = 0;
  // Sequential to respect connection_limit=1.
  for (const v of variants) {
    const newName = v.option1 ? KEEP[v.option1] : undefined;
    if (newName) {
      await prisma.variant.update({
        where: { id: v.id },
        data: { option1: newName, title: newName, isHidden: false },
      });
      kept++;
      console.log(`KEEP  pos${v.position}: "${v.option1}" -> "${newName}"`);
    } else {
      await prisma.variant.update({
        where: { id: v.id },
        data: { isHidden: true },
      });
      hidden++;
    }
  }

  console.log(`\nDONE — kept/visible: ${kept}, hidden (brown-cord): ${hidden}, total: ${variants.length}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
