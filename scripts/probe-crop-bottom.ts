/**
 * Re-screenshot one of the existing tabs cropped to just the prompt bar so
 * the slots are large enough to read in a small render window.
 */
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

async function main() {
  const src = "C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_progress_v25_hero_1_.png";
  const dst = "C:\\Users\\pc\\AppData\\Local\\Temp\\scene\\output\\_crop_promptbar.png";
  if (!fs.existsSync(src)) { console.error(`source not found: ${src}`); process.exit(1); }
  const meta = await sharp(src).metadata();
  console.log(`source: ${meta.width}x${meta.height}`);
  // crop to bottom-center prompt bar (slots are at y≈571 in 1440x900 viewport)
  // image likely 1440x900; bottom panel y from ~550 to ~830.
  const cropY = 540;
  const cropH = 290;
  await sharp(src).extract({ left: 0, top: cropY, width: meta.width || 1440, height: cropH }).resize({ width: 1800 }).toFile(dst);
  console.log(`wrote: ${dst}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
