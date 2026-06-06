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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
(async () => {
  const id = process.argv[2] ?? "cmpspa7wm0075w24ccqg9mzbn";
  const p = new PrismaClient();
  const prod = await p.product.findUnique({
    where: { id },
    select: { rawPayload: true },
  });
  if (!prod) { console.log("not found"); process.exit(0); }
  const raw = JSON.parse(prod.rawPayload);
  // Look for the bits that would tell us currency + original prices
  console.log("top-level keys:", Object.keys(raw));
  if (raw.currency) console.log("currency:", raw.currency);
  if (raw.sourceCurrency) console.log("sourceCurrency:", raw.sourceCurrency);
  if (raw.targetCurrency) console.log("targetCurrency:", raw.targetCurrency);
  if (raw.fxRate) console.log("fxRate:", raw.fxRate);
  if (raw.exchangeRate) console.log("exchangeRate:", raw.exchangeRate);
  // Variants
  if (raw.variants) {
    console.log("\nvariants (first 6):");
    for (const v of raw.variants.slice(0, 6)) {
      const subset: Record<string, unknown> = {};
      for (const k of Object.keys(v)) {
        if (/price|cost|currency|weight|sku|title|option/i.test(k)) subset[k] = v[k];
      }
      console.log(JSON.stringify(subset));
    }
  }
  // Pricing info if separate block
  if (raw.priceInfo) console.log("\npriceInfo:", JSON.stringify(raw.priceInfo, null, 2));
  if (raw.priceRange) console.log("\npriceRange:", JSON.stringify(raw.priceRange, null, 2));
  if (raw.skuInfoMap) console.log("\nskuInfoMap (first 3 keys):", Object.keys(raw.skuInfoMap).slice(0,3));
  console.log("\nraw.price (full):", JSON.stringify(raw.price, null, 2));
  console.log("\nraw.supplier:", JSON.stringify(raw.supplier, null, 2));
  console.log("\nraw.productWeightG:", raw.productWeightG);
  console.log("\nraw.featureAttributes (first 10):", JSON.stringify(raw.featureAttributes?.slice(0, 10), null, 2));
  await p.$disconnect();
})();
