/**
 * One-off: dump per-variant data for the jewellery-box parent so we can design
 * the split spec AND verify per-variant weight/price data exists for accurate
 * per-variant pricing. Read-only.
 *
 *   npx tsx scripts/_inspect-jewelry-variants.ts [productId]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
import { prisma } from "../src/lib/db";

const PID = process.argv[2] || "cmpxvghau000hw260fnktskfz";

(async () => {
  const product = await prisma.product.findUnique({
    where: { id: PID },
    include: { variants: { orderBy: { position: "asc" } } },
  });
  if (!product) {
    console.error("product not found:", PID);
    process.exit(1);
  }
  console.log(`PRODUCT ${product.id}`);
  console.log(`  title: ${product.title}`);
  console.log(`  optionNames: ${product.optionNames}`);
  console.log(`  variants: ${product.variants.length} (visible: ${product.variants.filter((v) => !v.isHidden).length})\n`);

  // ── Parse rawPayload to locate per-variant CNY price + weight ──────────────
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(product.rawPayload) as Record<string, unknown>;
  } catch {
    console.warn("  rawPayload not JSON-parseable");
  }
  console.log("rawPayload top-level keys:", Object.keys(raw).join(", "));
  // Common Bright Data 1688 shapes — probe likely per-SKU arrays.
  for (const k of ["skus", "skuProps", "variants", "skuMap", "productSkuInfos", "saleInfo"]) {
    if (raw[k] != null) {
      const val = raw[k];
      const sample = Array.isArray(val) ? val[0] : val;
      console.log(`\nrawPayload.${k} (sample):`);
      console.log(JSON.stringify(sample, null, 2).slice(0, 1200));
    }
  }

  console.log("\n──────── VARIANTS ────────");
  for (const v of product.variants) {
    console.log(
      [
        `#${String(v.position).padStart(2)}`,
        v.isHidden ? "HID" : "vis",
        `w=${v.weight ?? "?"}${v.weightUnit ?? ""}`,
        `price=${v.price}`,
        `cost=${v.supplierCost ?? "?"}`,
        `sku=${v.sku ?? "-"}`,
        `srcVid=${v.sourceVariantId ?? "-"}`,
        `feat=${v.featuredImageId ? "Y" : "n"}`,
      ].join("  "),
    );
    console.log(`     opt1: ${v.option1 ?? ""}`);
    if (v.option2) console.log(`     opt2: ${v.option2}`);
    if (v.option3) console.log(`     opt3: ${v.option3}`);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
