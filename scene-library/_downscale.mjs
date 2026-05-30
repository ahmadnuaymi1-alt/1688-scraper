// Throwaway view helper — downscales the latest lifestyle outputs for review.
import sharp from "sharp";
import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = "C:/Users/pc/AppData/Local/Temp/scene/output";
const VIEW = "C:/Users/pc/AppData/Local/Temp/scene/_view";
mkdirSync(VIEW, { recursive: true });

const files = readdirSync(OUT).filter((f) => /^v1_lifestyle_.*\.png$/i.test(f));
for (const f of files) {
  const dest = path.join(VIEW, f.replace(/\.png$/i, ".jpg"));
  await sharp(path.join(OUT, f))
    .resize(1100, 1100, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toFile(dest);
  console.log(dest);
}
