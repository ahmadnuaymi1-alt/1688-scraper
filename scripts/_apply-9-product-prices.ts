/**
 * Apply the 9-product pricing recommendations from the workflow (wunc1xicx)
 * to the LOCAL DB (Variant.price). These products are not yet uploaded to
 * Shopify — they're in the imports/review state — so updates land in Prisma.
 *
 * For multi-variant products, preserves the existing relative spread:
 *   factor = recommendedLaunch / currentMin
 *   newPrice = currentPrice × factor (rounded to 2 dp)
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// From workflow wunc1xicx — recommended launch prices.
const UPDATES: Array<{ productId: string; newLaunch: number; name: string }> = [
  { productId: "cmpspuo8e00wvw24cpnxkhj62", newLaunch: 149, name: "Stainless Steel Vertical Ribbed Outdoor Wall Sconce" },
  { productId: "cmpspc34s00j0w24c40x2tikh", newLaunch: 179, name: "Iron Walnut Flush Mount Silent Motor Fan-Light" },
  { productId: "cmpspbp9700gew24c1kfrcek7", newLaunch: 129, name: "Black Die-Cast Aluminum Linear LED 12W Outdoor Wall Light" },
  { productId: "cmpspbahc00c6w24cjae7uv6j", newLaunch: 129, name: "Iron Matte Black Conical Cage Motion Sensor Sconce" },
  { productId: "cmpspad7h0096w24cnrxdgycr", newLaunch: 189, name: "Imitation Cloud Stone Rectangular Outdoor Wall Sconce" },
  { productId: "cmpspa7wm0075w24ccqg9mzbn", newLaunch: 79, name: "Aluminum Black Linear 2-Light LED Outdoor Wall Sconce" },
  { productId: "cmpsp9wh7004ww24cr1n8oeki", newLaunch: 69, name: "Black Retro Abstract Solar Motion Sensor Outdoor Sconce" },
  { productId: "cmpsp9ppg002uw24chlb1gvmx", newLaunch: 99, name: "Aluminum Alloy Black Gold 2-Bead Outdoor Wall Sconce" },
  { productId: "cmpsp94gm001nw24cpwbzd5o0", newLaunch: 349, name: "Black Matte Die-Cast Aluminum Crystal COB Outdoor Sconce" },
];

async function main() {
  const prisma = new PrismaClient();
  const summary: Array<{ name: string; status: string; variantCount: number; oldMin: number; newMin: number; factor: number }> = [];

  for (const u of UPDATES) {
    const product = await prisma.product.findUnique({
      where: { id: u.productId },
      select: {
        id: true, title: true,
        variants: { orderBy: { position: "asc" }, select: { id: true, position: true, title: true, price: true } },
      },
    });
    if (!product) {
      console.log(`\n✗ ${u.name}: product ${u.productId} not found`);
      summary.push({ name: u.name, status: "NOT FOUND", variantCount: 0, oldMin: 0, newMin: 0, factor: 0 });
      continue;
    }
    const prices = product.variants.map((v) => parseFloat(v.price));
    const currentMin = Math.min(...prices.filter((p) => Number.isFinite(p) && p > 0));
    if (!Number.isFinite(currentMin) || currentMin <= 0) {
      console.log(`\n✗ ${u.name}: cannot resolve currentMin from variants`);
      summary.push({ name: u.name, status: "BAD CURRENT", variantCount: product.variants.length, oldMin: 0, newMin: 0, factor: 0 });
      continue;
    }
    const factor = u.newLaunch / currentMin;

    console.log(`\n→ ${u.name} (${product.variants.length} variants)`);
    console.log(`   anchor: min ${currentMin.toFixed(2)} → ${u.newLaunch}  factor ${factor.toFixed(3)}`);

    // Batch update — Promise.all per memory rule "bulk ops parallel not sequential"
    const updates = product.variants.map((v) => {
      const oldP = parseFloat(v.price);
      const newP = oldP === currentMin ? u.newLaunch : Math.round(oldP * factor * 100) / 100;
      return { id: v.id, oldP, newP, title: v.title };
    });
    // Print preview
    for (const upd of updates.slice(0, 4)) {
      console.log(`     ${(upd.title ?? "").slice(0, 38).padEnd(38)}  $${upd.oldP.toFixed(2)}  →  $${upd.newP.toFixed(2)}`);
    }
    if (updates.length > 4) console.log(`     … +${updates.length - 4} more variants scaled`);

    await Promise.all(
      updates.map((upd) =>
        prisma.variant.update({
          where: { id: upd.id },
          data: { price: upd.newP.toFixed(2) },
        }),
      ),
    );
    console.log(`   ✓ updated`);
    summary.push({ name: u.name, status: "OK", variantCount: product.variants.length, oldMin: currentMin, newMin: u.newLaunch, factor });
  }

  console.log(`\n========== SUMMARY ==========`);
  for (const s of summary) {
    console.log(`  ${s.status.padEnd(10)} ${s.name.padEnd(60)} ${s.variantCount} var(s)  $${s.oldMin.toFixed(2)} → $${s.newMin.toFixed(2)}`);
  }
  const ok = summary.filter((s) => s.status === "OK").length;
  console.log(`\nTotal: ${ok}/${UPDATES.length} OK`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
