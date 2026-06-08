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
  // image rule (clean gallery) then gallery preset (orders the new closeup)
  const { reapplyRules } = await import("../src/services/rule.service");
  await reapplyRules(PID, ["image"] as any);
  console.log("image rule reapplied");
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
  await applyGalleryPreset(PID);
  console.log("gallery preset applied");

  const prisma = new PrismaClient();
  try {
    const prod = await prisma.product.findUnique({
      where: { id: PID },
      include: {
        variants: { orderBy: { position: "asc" } },
        images: { orderBy: { position: "asc" } },
      },
    });
    if (!prod) throw new Error("not found");
    const byType: Record<string, number> = {};
    for (const i of prod.images) { const k = i.imageType ?? "(source)"; byType[k] = (byType[k] ?? 0) + 1; }
    const survivingAlicdn = prod.images.filter((i) => i.imageType === null && (i.sourceUrl ?? "").includes("alicdn")).length;
    const visible = prod.variants.filter((v) => !v.isHidden);

    console.log("\n================ FINAL SANITY ================");
    console.log(`Title: ${prod.title}`);
    console.log(`ProductType: ${prod.productType} | optionNames: ${prod.optionNames}`);
    console.log(`Visible variants: ${visible.length}/${prod.variants.length}`);
    console.log(`Images byType: ${JSON.stringify(byType)}`);
    console.log(`Surviving .alicdn originals: ${survivingAlicdn}`);
    console.log(`Tags: ${prod.tags}`);
    console.log(`\nGallery order (first 14):`);
    for (const i of prod.images.slice(0, 14)) {
      console.log(`  pos=${i.position} type=${i.imageType ?? "(source)"} v=${i.variantId?.slice(-8) ?? "-"} ${(i.fileName ?? "").slice(0, 50)}`);
    }
    console.log(`\nVariants + heroes:`);
    for (const v of visible) {
      const hasHero = prod.images.some((im) => im.variantId === v.id && im.imageType === "hero-flat");
      console.log(`  #${v.position} ${v.option1}  $${v.price}  cAt=${v.compareAtPrice ?? "null"}  hero=${hasHero ? "Y" : "N"}`);
    }
    // dim check echo
    const dimRow = (prod.descriptionHtml ?? "").match(/Dimensions<\/th><td>([^<]+)</)?.[1] ?? "(not found)";
    const weightRow = (prod.descriptionHtml ?? "").match(/Weight<\/th><td>([^<]+)</)?.[1] ?? "(not found)";
    console.log(`\nSpec dims: ${dimRow.trim()} | weight: ${weightRow.trim()}`);
  } finally { await prisma.$disconnect(); }
})();
