/**
 * Vision-probe a sample of cmpjswf6e's description images to see what
 * dimensional data is visible on them. Helps decide whether a deeper
 * per-variant dimension-extraction step is feasible.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { claudeVision } from "../src/lib/ai/claude-client";

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

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: "cmpjswf6e00njw2ggf8fceqtd" },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }

  // Pull description images (positions 1-12 from earlier probe). Skip type=hero
  const galleryImgs = p.images
    .filter((i) => i.imageType === null || i.imageType === "source")
    .slice(0, 8);

  console.log(`Probing ${galleryImgs.length} description image(s) for dimensional data...\n`);

  for (const img of galleryImgs) {
    const url = img.sourceUrl;
    console.log(`\n--- pos=${img.position} ---`);
    console.log(`URL: ${url}`);
    try {
      const res = await fetch(url);
      if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const resized = await sharp(buf)
        .rotate()
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;
      const raw = await claudeVision({
        imageUrl: dataUri,
        prompt:
          `Extract every piece of measurable / dimensional information visible on this product image. ` +
          `Look for: width, height, depth, diameter, length, weight, wattage, voltage, coverage area (m²), color temperature (K), socket type, IP rating, etc. ` +
          `Also extract any per-model or per-size labels (e.g. "682黑色高度45厘米" — Model 682 Black Height 45cm). ` +
          `Return as a flat list, one item per line. Translate Chinese to English. Include the original-language source if useful. ` +
          `If the image has no dimensional info, say "NO_DIMS".`,
        maxTokens: 800,
        temperature: 0,
      });
      console.log(raw.slice(0, 1200));
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
