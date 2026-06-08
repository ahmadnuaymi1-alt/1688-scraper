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

const PIDS = ["cmq3j26mt001jw2p8u0fby3x4", "cmq3j2mj20032w2p8arpaf42z", "cmq3yck9q000jw2q03468fge7"];

(async () => {
  const p = new PrismaClient();
  for (const pid of PIDS) {
    const product = await p.product.findUnique({
      where: { id: pid },
      select: {
        id: true, title: true, productType: true, optionNames: true,
        descriptionHtml: true, pricingNotes: true,
        variants: { orderBy: { position: "asc" }, select: { id: true, position: true, title: true, option1: true, isHidden: true, featuredImageId: true, price: true } },
        images: { select: { id: true, imageType: true, sourceUrl: true } },
      },
    });
    if (!product) { console.log(`${pid}: NOT FOUND\n`); continue; }
    const visible = product.variants.filter((v) => !v.isHidden);
    const typeCount: Record<string, number> = {};
    for (const img of product.images) {
      const t = img.imageType ?? "(source)";
      typeCount[t] = (typeCount[t] ?? 0) + 1;
    }
    const aliCount = product.images.filter((i) => {
      try { return new URL(i.sourceUrl).hostname.endsWith(".alicdn.com"); } catch { return false; }
    }).length;
    const pricingHasRecommendation = !!product.pricingNotes;
    console.log(`=== ${pid} ===`);
    console.log(`Title: ${product.title}`);
    console.log(`ProductType: ${product.productType ?? "(null)"}`);
    console.log(`OptionNames: ${product.optionNames ?? "(null)"}`);
    console.log(`Description length: ${product.descriptionHtml?.length ?? 0}`);
    console.log(`Variants: ${visible.length} visible / ${product.variants.length} total`);
    console.log(`Variant prices: ${visible.map((v) => `#${v.position}=${v.price}`).slice(0, 5).join(", ")}${visible.length > 5 ? "..." : ""}`);
    console.log(`Images: ${JSON.stringify(typeCount)}`);
    console.log(`.alicdn.com originals remaining: ${aliCount}`);
    console.log(`Pricing notes set: ${pricingHasRecommendation}`);
    console.log();
  }
  await p.$disconnect();
})();
