/**
 * One-off data fix for product cmpsp94gm001nw24cpwbzd5o0
 * (Black Matte Crystal COB LED Outdoor Wall Sconce).
 *
 * The per-size dimensions + weights are already in the scrape (extractedSpecs /
 * rawPayload.packingDimensionsRows) but aren't surfaced. This:
 *   1. Relabels the 3 live variants so the Size option MENTIONS its dimensions.
 *   2. Replaces the single Small-only "Base Weight" spec with per-size weights
 *      (Small/Medium/Large) derived from the packing rows, in lb.
 *
 * After this, re-run the description rule to regenerate the description.
 *
 *   npx tsx scripts/_fix-cmpsp94gm-dims-weight.ts
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

const PRODUCT_ID = "cmpsp94gm001nw24cpwbzd5o0";

// size label -> dimensions string (already in extractedSpecs, US inches)
const SIZE_DIMS: Record<string, string> = {
  Small: '4.3"W × 14.6"H × 3.3"D',
  Medium: '5.7"W × 18.3"H × 3.3"D',
  Large: '6.7"W × 22.2"H × 3.7"D',
};
// size label -> product weight in lb (from packingDimensionsRows: 3300/6450/10500 g)
const SIZE_WEIGHT_LB: Record<string, string> = {
  Small: "7.3 lb",
  Medium: "14.2 lb",
  Large: "23.1 lb",
};

async function main() {
  const prisma = new PrismaClient();

  // 1) Variants: relabel option1 + title to "Size (dimensions)"
  const variants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID, isHidden: false },
    orderBy: { position: "asc" },
    select: { id: true, option1: true, title: true },
  });
  for (const v of variants) {
    const size = (v.option1 ?? "").trim();
    const dims = SIZE_DIMS[size];
    if (!dims) {
      console.log(`  ! skip variant ${v.id} — unmapped option1 "${size}"`);
      continue;
    }
    const newLabel = `${size} (${dims})`;
    await prisma.variant.update({
      where: { id: v.id },
      data: { option1: newLabel, title: newLabel },
    });
    console.log(`  variant ${v.id}: "${size}" -> "${newLabel}"`);
  }

  // 2) extractedSpecs: drop existing weight rows, add per-size weight rows.
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { productContext: true },
  });
  if (!product?.productContext) {
    console.error("No productContext to update."); process.exit(1);
  }
  const ctx = JSON.parse(product.productContext) as {
    extractedSpecs?: Array<{ name: string; value: string }>;
    [k: string]: unknown;
  };
  const specs = Array.isArray(ctx.extractedSpecs) ? ctx.extractedSpecs : [];
  const before = specs.length;
  // Strip curated-out motion-sensor entries from any option/wattage spec — no
  // motion-sensor variant is live, so it must not surface as buyable.
  for (const s of specs) {
    if (/wattage|option|power|sensor|color/i.test(s.name) && /sensor|感应/i.test(s.value)) {
      const cleaned = s.value
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter((part) => part && !/sensor|感应/i.test(part))
        .join(", ");
      if (cleaned && cleaned !== s.value) {
        console.log(`  spec "${s.name}": dropped motion-sensor entries -> "${cleaned}"`);
        s.value = cleaned;
      }
    }
  }
  // Drop any existing weight-ish rows (e.g. "Base Weight", "Weight").
  const kept = specs.filter((s) => !/weight/i.test(s.name));
  // Insert per-size weight rows right after the last "Dimensions (...)" row so
  // weight sits near the dimensions in the table.
  const lastDimIdx = kept.reduce((acc, s, i) => (/^dimensions\b/i.test(s.name) ? i : acc), -1);
  const weightRows = (["Small", "Medium", "Large"] as const).map((sz) => ({
    name: `Weight (${sz})`,
    value: SIZE_WEIGHT_LB[sz],
  }));
  if (lastDimIdx >= 0) kept.splice(lastDimIdx + 1, 0, ...weightRows);
  else kept.push(...weightRows);
  ctx.extractedSpecs = kept;

  await prisma.product.update({
    where: { id: PRODUCT_ID },
    data: { productContext: JSON.stringify(ctx) },
  });
  console.log(`  extractedSpecs: ${before} -> ${kept.length} (dropped weight rows, added 3 per-size weights)`);

  await prisma.$disconnect();
  console.log("Done. Now run: npx tsx scripts/_run-description-rule.ts cmpsp94gm001nw24cpwbzd5o0");
}
main().catch((e) => { console.error("UNHANDLED:", e); process.exit(1); });
