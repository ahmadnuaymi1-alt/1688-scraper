/**
 * Non-destructive probe for the luxury-rename prompt block in Stage B of the
 * variant curator. Feeds the curator a synthetic variant list with placeholder
 * design names ("Plastic Stand", "Stand Model B", "Standard") and asserts that
 * the rebranded `optionNames`/option values are NOT the originals.
 *
 * Pure dry-run — no DB writes. Cost: 1 Claude Haiku 4.5 call (~$0.003).
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

const GENERIC_DESIGN_NAMES = ["Plastic Stand", "Stand Model B", "Standard", "Frame Lamp"];

async function main() {
  const { autoCurateVariants } = await import("../src/services/variant-curation.service.js");

  // Synthetic input: 4 designs × 2 color temps × 2 powers. Generic design labels.
  // Designed to look like a single packed "Design" axis we want Stage B to keep
  // as one axis but rename to luxury equivalents.
  const variants = [] as Array<{
    title: string;
    option1?: string;
    option2?: string;
    option3?: string;
    price: string;
    position: number;
    sourceVariantId?: string;
    supplierLabel1?: string;
    supplierLabel2?: string;
    supplierLabel3?: string;
  }>;
  let pos = 1;
  for (const design of GENERIC_DESIGN_NAMES) {
    for (const temp of ["Warm White", "Cool White"]) {
      for (const power of ["5W", "10W"]) {
        variants.push({
          title: `${design} / ${temp} / ${power}`,
          option1: design,
          option2: temp,
          option3: power,
          price: "12.99",
          position: pos++,
          sourceVariantId: `synthetic-${pos}`,
          supplierLabel1: design,
          supplierLabel2: temp,
          supplierLabel3: power,
        });
      }
    }
  }

  console.log(`Synthetic input: ${variants.length} variants, design values:`);
  for (const d of GENERIC_DESIGN_NAMES) console.log(`  - "${d}"`);

  console.log("\nCalling autoCurateVariants (Stage A + Stage B)...");
  const result = await autoCurateVariants(
    variants,
    "Cordless Bedside Reading Lamp",
    ["Design", "Color Temperature", "Power"],
  );

  console.log("\n=== RESULT ===");
  console.log(`optionNames: ${JSON.stringify(result.optionNames)}`);
  console.log(`Kept: ${result.kept.length}  Dropped: ${result.dropped.length}  Renamed: ${result.renamed.length}`);

  // Collect unique values on every axis after curation.
  const axisValues: string[][] = result.optionNames.map(() => []);
  const seenPerAxis: Set<string>[] = result.optionNames.map(() => new Set());
  for (const v of result.kept) {
    const vals = [v.option1, v.option2, v.option3];
    for (let i = 0; i < result.optionNames.length; i++) {
      const val = vals[i];
      if (val && !seenPerAxis[i].has(val)) {
        seenPerAxis[i].add(val);
        axisValues[i].push(val);
      }
    }
  }
  for (let i = 0; i < result.optionNames.length; i++) {
    console.log(`  ${result.optionNames[i]}: ${JSON.stringify(axisValues[i])}`);
  }

  // PASS criterion: NONE of the original generic design names should appear
  // verbatim in any axis values.
  const allValues = axisValues.flat();
  const leakedGenerics = GENERIC_DESIGN_NAMES.filter((g) =>
    allValues.some((v) => v.toLowerCase() === g.toLowerCase()),
  );

  console.log("");
  if (leakedGenerics.length === 0) {
    console.log(`✓ PASS — no generic design names leaked through. All design values were rebranded.`);
  } else {
    console.log(`✗ FAIL — these generic names appeared verbatim: ${JSON.stringify(leakedGenerics)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
