/** Inspect product cmq48d6pa000jw2fw81cyt2gy for agent-mode judgment. */
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

const PID = "cmq48d6pa000jw2fw81cyt2gy";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PID },
    select: {
      id: true, title: true, productType: true, optionNames: true,
      descriptionHtml: true, tags: true, pricingNotes: true, scrapeJobId: true,
    },
  });
  if (!p) { console.log("PRODUCT NOT FOUND"); await prisma.$disconnect(); return; }
  console.log("=== PRODUCT ===");
  console.log("title:", p.title);
  console.log("productType:", JSON.stringify(p.productType));
  console.log("optionNames:", JSON.stringify(p.optionNames));
  console.log("tags:", JSON.stringify(p.tags));

  if (p.scrapeJobId) {
    const job = await prisma.scrapeJob.findUnique({ where: { id: p.scrapeJobId }, select: { status: true, sourceUrl: true } });
    console.log("scrapeJob.status:", job?.status, "| sourceUrl:", job?.sourceUrl);
  }

  const variants = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: {
      id: true, position: true, title: true, option1: true, option2: true, option3: true,
      isHidden: true, price: true, compareAtPrice: true, sku: true,
      weight: true, weightUnit: true, featuredImageId: true,
      supplierLabel1: true, supplierLabel2: true, supplierLabel3: true,
    },
  });
  console.log(`\n=== VARIANTS (${variants.length} total) ===`);
  for (const v of variants) {
    console.log(
      `[pos ${v.position}] ${v.isHidden ? "HIDDEN " : "visible"} | title=${JSON.stringify(v.title)} | o1=${JSON.stringify(v.option1)} o2=${JSON.stringify(v.option2)} o3=${JSON.stringify(v.option3)} | supLbl=${JSON.stringify([v.supplierLabel1, v.supplierLabel2, v.supplierLabel3])} | price=${v.price} cmp=${v.compareAtPrice} | wt=${v.weight}${v.weightUnit ?? ""} | featImg=${v.featuredImageId ?? "—"}`
    );
  }
  const visible = variants.filter((v) => !v.isHidden);
  console.log(`\nVISIBLE: ${visible.length} / ${variants.length}`);

  const imgs = await prisma.productImage.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { id: true, position: true, sourceUrl: true, storagePath: true, imageType: true, keep: true, variantId: true, altText: true },
  });
  console.log(`\n=== IMAGES (${imgs.length}) ===`);
  for (const im of imgs) {
    const host = (() => { try { return new URL(im.sourceUrl).host; } catch { return "?"; } })();
    console.log(
      `[pos ${im.position}] type=${im.imageType ?? "null"} keep=${im.keep} host=${host} variant=${im.variantId ?? "—"} id=${im.id} alt=${JSON.stringify((im.altText ?? "").slice(0, 40))}`
    );
  }

  console.log("\n=== DESCRIPTION HTML (raw) ===");
  console.log(p.descriptionHtml ?? "(none)");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
