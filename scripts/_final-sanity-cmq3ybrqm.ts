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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";

(async () => {
  const p = new PrismaClient();
  try {
    const allImgs = await p.productImage.findMany({
      where: { productId: PID },
      select: { id: true, imageType: true, sourceUrl: true, keep: true, variantId: true },
    });
    console.log(`Total ProductImage rows: ${allImgs.length}`);
    const byType = new Map<string, number>();
    let alicdnSurvived = 0;
    for (const img of allImgs) {
      const t = img.imageType ?? "null";
      byType.set(t, (byType.get(t) ?? 0) + 1);
      try {
        const h = new URL(img.sourceUrl).hostname;
        if (h.endsWith(".alicdn.com") || h === "alicdn.com") {
          alicdnSurvived++;
          console.log(`  ALICDN SURVIVED: id=${img.id} type=${img.imageType} keep=${img.keep} url=${img.sourceUrl.slice(0,80)}`);
        }
      } catch {}
    }
    console.log("\nBy imageType:");
    for (const [k, v] of byType) console.log(`  ${k}: ${v}`);
    console.log(`\n.alicdn.com survived (should be 0 unless user-starred): ${alicdnSurvived}`);

    const visibleVariants = await p.variant.count({ where: { productId: PID, isHidden: false } });
    const totalVariants = await p.variant.count({ where: { productId: PID } });
    console.log(`Variants visible/total: ${visibleVariants}/${totalVariants}`);

    const variantsWithHero = await p.variant.findMany({
      where: { productId: PID, isHidden: false },
      select: { position: true, option1: true, featuredImage: { select: { imageType: true } } },
      orderBy: { position: "asc" },
    });
    const missingHero = variantsWithHero.filter(v => v.featuredImage?.imageType !== "hero-flat" && v.featuredImage?.imageType !== "hero");
    if (missingHero.length === 0) {
      console.log(`All ${variantsWithHero.length} visible variants have a hero featured.`);
    } else {
      console.log(`MISSING HEROES (${missingHero.length}):`);
      for (const v of missingHero) console.log(`  #${v.position} ${v.option1} → featuredImage.type=${v.featuredImage?.imageType ?? "null"}`);
    }

    const product = await p.product.findUnique({
      where: { id: PID },
      select: { title: true, productType: true, descriptionHtml: true, metaDescription: true, tags: true },
    });
    const desc = product?.descriptionHtml ?? "";
    const matches = desc.match(/(\d+) (?:color variants|colors|colour variants|colours)/gi);
    console.log(`\nDescription mentions of color count: ${matches ? matches.join(", ") : "(none)"}`);
    console.log(`Description length: ${desc.length} chars`);
    console.log(`Title: ${product?.title}`);
    console.log(`productType: ${product?.productType}`);
    console.log(`Tags contains 1688 URL: ${(product?.tags ?? "").includes("detail.1688.com")}`);
  } finally {
    await p.$disconnect();
  }
})().catch(e => { console.error(e); process.exit(1); });
