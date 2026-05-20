/**
 * Crop slot row from a specific tab's progress screenshot.
 * Usage: npx tsx scripts/probe-crop-tab.ts <tabNum>
 */
import fs from "node:fs";
import sharp from "sharp";

async function main() {
  const tabNum = process.argv[2] || "1";
  const src = `C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_progress_v25_hero_${tabNum}_.png`;
  const dst = `C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_crop_slots_${tabNum}.png`;
  if (!fs.existsSync(src)) { console.error(`source not found: ${src}`); process.exit(1); }
  const meta = await sharp(src).metadata();
  await sharp(src)
    .extract({ left: 100, top: 540, width: 480, height: 110 })
    .resize({ width: 1600 })
    .toFile(dst);
  console.log(`wrote: ${dst}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
