/**
 * Read-only batch dump of pricing-relevant data for multiple products + their
 * Shopify upload handles (so the user can click through).
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

const IDS = process.argv.slice(2);
if (IDS.length === 0) { console.error("usage: tsx _show-pricing-batch.ts <id1> <id2> …"); process.exit(1); }

(async () => {
  const prisma = new PrismaClient();
  for (const id of IDS) {
    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true, title: true, productType: true, productContext: true, rawPayload: true,
        variants: { orderBy: { position: "asc" }, select: { position: true, title: true, price: true, supplierCost: true, weight: true, weightUnit: true } },
        uploads: { select: { shopifyHandle: true, shopifyProductId: true, status: true, completedAt: true } },
      },
    });
    if (!p) { console.log(`\n==== ${id} NOT FOUND ====`); continue; }
    const raw = JSON.parse(p.rawPayload);
    const ctx = p.productContext ? JSON.parse(p.productContext) : null;
    console.log(`\n${"=".repeat(72)}`);
    console.log(`${p.id} — ${p.title}`);
    console.log(`Type: ${p.productType ?? "(none)"}`);
    console.log(`Upload: ${p.uploads[0]?.shopifyHandle ?? "(not uploaded)"} status=${p.uploads[0]?.status ?? "?"}`);
    console.log(`Public URL: https://vilvida.com/products/${p.uploads[0]?.shopifyHandle ?? "?"}`);
    console.log(`Raw 1688 price: ${JSON.stringify(raw.price)} weight=${raw.productWeightG}g supplier=${raw.supplier?.companyName ?? "?"}`);
    console.log(`Variants (${p.variants.length}):`);
    for (const v of p.variants.slice(0, 8)) {
      console.log(`  pos${String(v.position).padStart(2)} ${(v.title ?? "").slice(0, 45).padEnd(45)} ` +
        `price=$${v.price ?? "?"} supplier=${v.supplierCost ?? "?"} weight=${v.weight ?? "?"}${v.weightUnit ?? ""}`);
    }
    if (p.variants.length > 8) console.log(`  … +${p.variants.length - 8} more`);
    if (ctx?.marketingAngles?.length) console.log(`Angles: ${ctx.marketingAngles.slice(0, 4).join(" • ")}`);
    if (ctx?.extractedSpecs?.length) {
      console.log(`Key specs:`);
      const want = /material|dim|size|width|height|wattage|power|light|color|temp|ip|rating|installation|style|finish/i;
      for (const s of ctx.extractedSpecs.slice(0, 30)) {
        if (want.test(s.name)) console.log(`  ${s.name}: ${s.value}`);
      }
    }
  }
  await prisma.$disconnect();
})();
