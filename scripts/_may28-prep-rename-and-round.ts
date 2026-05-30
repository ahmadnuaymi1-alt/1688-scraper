/**
 * Pre-image prep for the 5/28 fan-light batch:
 *   1. Rename the Style A / Style B variants on cmppqgin7004cw2vs04697sgd
 *      to descriptive physical-design names. (Bamboo fan light has two
 *      genuinely distinct silhouettes — A is a 50cm oval flush mount with
 *      no canopy; B is a 53cm wider semi-flush with a visible black canopy
 *      plate. Renaming so the customer knows what they're picking.)
 *   2. Round every visible variant's price (and compareAtPrice when set) to
 *      the nearest XX9 / XXX9 psychology breakpoint on the 9 products.
 *
 * Both steps are idempotent. Outputs a per-product report.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

const IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppv6kdl00rjw2vsnhsp6sqn",
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

/**
 * Round price to the nearest value ending in 9 (.e.g. ...9, ...19, ...29).
 * For values below 9, clamp to 9.
 */
function roundToNearest9(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  if (value < 9) return 9;
  // Snap to nearest multiple of 10, then subtract 1.
  const snapped = Math.round(value / 10) * 10 - 1;
  return snapped < 9 ? 9 : snapped;
}

async function renameStyleAB(productId: string): Promise<void> {
  if (productId !== "cmppqgin7004cw2vs04697sgd") return;
  const variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { position: "asc" },
  });
  const a = variants.find(
    (v) => (v.option1 ?? "").trim().toLowerCase() === "style a",
  );
  const b = variants.find(
    (v) => (v.option1 ?? "").trim().toLowerCase() === "style b",
  );
  if (a) {
    const newOpt = "Oval Flush 50cm";
    const newTitle = newOpt; // single-axis option1-only title
    await prisma.variant.update({
      where: { id: a.id },
      data: { option1: newOpt, title: newTitle },
    });
    console.log(`  renamed pos=${a.position}: "${a.option1}" → "${newOpt}"`);
  }
  if (b) {
    const newOpt = "Semi-Flush Canopy 53cm";
    const newTitle = newOpt;
    await prisma.variant.update({
      where: { id: b.id },
      data: { option1: newOpt, title: newTitle },
    });
    console.log(`  renamed pos=${b.position}: "${b.option1}" → "${newOpt}"`);
  }
}

async function roundPricesForProduct(productId: string): Promise<void> {
  const variants = await prisma.variant.findMany({
    where: { productId, isHidden: false },
    select: { id: true, position: true, price: true, compareAtPrice: true },
  });
  let touched = 0;
  for (const v of variants) {
    const data: { price?: string; compareAtPrice?: string } = {};
    const priceNum = v.price ? parseFloat(v.price.toString()) : 0;
    if (priceNum > 0) {
      const rounded = roundToNearest9(priceNum);
      if (Math.abs(rounded - priceNum) >= 0.005) {
        data.price = rounded.toString();
      }
    }
    if (v.compareAtPrice) {
      const cmpNum = parseFloat(v.compareAtPrice.toString());
      if (cmpNum > 0) {
        const rounded = roundToNearest9(cmpNum);
        if (Math.abs(rounded - cmpNum) >= 0.005) {
          data.compareAtPrice = rounded.toString();
        }
      }
    }
    if (Object.keys(data).length > 0) {
      await prisma.variant.update({ where: { id: v.id }, data });
      touched++;
    }
  }
  console.log(`  rounded ${touched}/${variants.length} variant prices`);
}

(async () => {
  for (const id of IDS) {
    const p = await prisma.product.findUnique({
      where: { id },
      select: { title: true },
    });
    console.log(`\n${id}  ${(p?.title ?? "—").slice(0, 60)}`);
    await renameStyleAB(id);
    await roundPricesForProduct(id);
  }
  await prisma.$disconnect();
})();
