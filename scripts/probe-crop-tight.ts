/**
 * Tight crop of just the slot row from a progress screenshot.
 */
import fs from "node:fs";
import sharp from "sharp";

async function main() {
  const src = "C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_progress_v25_hero_1_.png";
  const dst = "C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_crop_slots.png";
  if (!fs.existsSync(src)) { console.error(`source not found: ${src}`); process.exit(1); }
  const meta = await sharp(src).metadata();
  console.log(`source: ${meta.width}x${meta.height}`);
  // The 4 slots are at x=185..433, y=571..627 in a 1440x900 viewport.
  // The full screenshot may be scaled. Crop a wider area around them.
  await sharp(src)
    .extract({ left: 100, top: 540, width: 480, height: 110 })
    .resize({ width: 1600 })
    .toFile(dst);
  console.log(`wrote: ${dst}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
