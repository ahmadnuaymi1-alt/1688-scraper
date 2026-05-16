/**
 * Manual run of the variant-image auto-fill service.
 *
 * Usage:
 *   npx tsx scripts/_autofill-variant-images.ts <productId>
 *
 * Loads .env.local for DATABASE_URL. Prints a proposal table of every
 * fill the algorithm chose (target ← donor, score), then a summary line.
 * NOTE: this actually writes — there is no dry-run flag. Run on a product
 * you own. The picker on /review/<id> can revert any individual fill.
 */

import fs from "node:fs";
import path from "node:path";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const productId = process.argv[2] || process.env.PRODUCT_ID;
  if (!productId) {
    console.error("Usage: npx tsx scripts/_autofill-variant-images.ts <productId>");
    process.exit(1);
  }
  const { autoFillVariantImages } = await import("../src/services/variant-image-autofill.service.js");
  const result = await autoFillVariantImages(productId);

  console.log(`Threshold: ${result.threshold} axis match(es) required.`);
  console.log("");
  if (result.details.length === 0) {
    console.log("(nothing to fill)");
  } else {
    for (const d of result.details) {
      console.log(
        `  ${d.variantLabel.padEnd(40)} ← ${d.sourceLabel.padEnd(40)} (score ${d.score})`,
      );
    }
  }
  console.log("");
  console.log(
    `Filled: ${result.filled}  Skipped (no match ≥ threshold): ${result.skippedNoMatch}  Already had image: ${result.alreadyFilled}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
