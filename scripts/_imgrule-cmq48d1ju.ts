import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
function loadEnv(): void {
  const e = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(e)) return;
  for (const l of fs.readFileSync(e, "utf-8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
const PID = "cmq48d1ju000jw2gowuwbmolt";
(async () => {
  const prisma = new PrismaClient();
  // First: ensure positions are contiguous (compact) so the image rule sees no gaps.
  const imgs = await prisma.productImage.findMany({ where: { productId: PID }, orderBy: { position: "asc" }, select: { id: true, position: true } });
  for (let i = 0; i < imgs.length; i++) {
    if (imgs[i].position !== i) {
      await prisma.productImage.update({ where: { id: imgs[i].id }, data: { position: i } });
    }
  }
  console.log(`Compacted ${imgs.length} images to positions 0..${imgs.length - 1}`);
  await prisma.$disconnect();

  const { reapplyRules } = await import("../src/services/rule.service");
  await reapplyRules(PID, ["image"] as any);
  console.log("image rule reapplied (contiguous)");
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
  await applyGalleryPreset(PID);
  console.log("gallery preset reapplied");

  const p2 = new PrismaClient();
  const after = await p2.productImage.findMany({ where: { productId: PID }, orderBy: { position: "asc" }, select: { position: true, imageType: true, fileName: true, altText: true } });
  console.log(`\nFinal gallery (${after.length}):`);
  for (const i of after) console.log(`  pos=${i.position} type=${i.imageType ?? "(source)"} file=${(i.fileName ?? "").slice(0, 55)} alt="${(i.altText ?? "").slice(0, 45)}"`);
  await p2.$disconnect();
})();
