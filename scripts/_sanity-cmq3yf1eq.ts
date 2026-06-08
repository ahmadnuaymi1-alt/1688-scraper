/**
 * Step 10 — final sanity for cmq3yf1eq000jw2kcemhuhsp9.
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq3yf1eq000jw2kcemhuhsp9";

(async () => {
  const p = new PrismaClient();
  try {
    const product = await p.product.findUnique({
      where: { id: PID },
      select: {
        title: true, productType: true, optionNames: true, tags: true,
        descriptionHtml: true, metaDescription: true, handle: true,
        variants: { orderBy: { position: "asc" }, select: { position: true, title: true, isHidden: true, price: true } },
        images: { select: { id: true, imageType: true, sourceUrl: true, keep: true, variantId: true } },
      },
    });
    if (!product) { console.log("NOT FOUND"); return; }
    const visible = product.variants.filter((v) => !v.isHidden);
    console.log("Title:", product.title);
    console.log("Handle:", product.handle);
    console.log("ProductType:", product.productType);
    console.log("OptionNames:", product.optionNames);
    console.log("Visible variants:", visible.length, "/ total:", product.variants.length);
    console.log("\nTags:");
    console.log(product.tags);
    console.log("\nMeta description:");
    console.log(product.metaDescription);

    // Image counts by type
    const byType = new Map<string, number>();
    for (const i of product.images) {
      const k = i.imageType ?? "(null)";
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    console.log("\nImage counts by type:");
    for (const [k, n] of byType) console.log(`  ${k}: ${n}`);

    const surviving = product.images.filter((i) => {
      try {
        const h = new URL(i.sourceUrl).hostname;
        return h.endsWith(".alicdn.com");
      } catch { return false; }
    });
    console.log("\nSurviving .alicdn.com rows:", surviving.length);
    console.log("(of which kept=true):", surviving.filter((s) => s.keep).length);

    // Heroes attached per variant
    const heroByVariant = new Map<string, number>();
    for (const i of product.images) {
      if ((i.imageType === "hero" || i.imageType === "hero-flat") && i.variantId) {
        heroByVariant.set(i.variantId, (heroByVariant.get(i.variantId) ?? 0) + 1);
      }
    }
    console.log("\nVariants:");
    for (const v of product.variants) {
      console.log(`  pos=${v.position} hidden=${v.isHidden} price=${v.price} title=${v.title}`);
    }

    console.log("\ndescription length:", product.descriptionHtml?.length ?? 0);
    console.log("description first 600 chars:");
    console.log(product.descriptionHtml?.slice(0, 600));
  } finally {
    await p.$disconnect();
  }
})();
