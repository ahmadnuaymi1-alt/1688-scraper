/**
 * Full inspect for cmq48cyg3 (jewelry box). Read-only.
 *   npx tsx scripts/_inspect-cmq48cyg3.ts
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

const ID = "cmq48cyg3000jw2g46nf689gj";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: ID },
    include: { variants: { orderBy: { position: "asc" } } },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }

  console.log("=== PRODUCT ===");
  console.log("title:", p.title);
  console.log("productType:", JSON.stringify(p.productType));
  console.log("optionNames:", JSON.stringify(p.optionNames));
  console.log("status:", p.status);
  console.log("tags:", JSON.stringify(p.tags));
  console.log("pricingNotes set:", !!p.pricingNotes);

  console.log("\n=== VARIANTS (", p.variants.length, ") ===");
  for (const v of p.variants) {
    console.log(
      `[pos ${v.position}] ${v.isHidden ? "HIDDEN" : "VIS   "} | ` +
      `o1=${JSON.stringify(v.option1)} o2=${JSON.stringify(v.option2)} o3=${JSON.stringify(v.option3)} | ` +
      `featImg=${v.featuredImageId ?? "—"} | price=${v.price} | sku=${JSON.stringify(v.sku)} | wt=${v.weight}`,
    );
  }

  // Images
  const imgs = await prisma.productImage.findMany({
    where: { productId: ID },
    orderBy: { position: "asc" },
  });
  console.log("\n=== IMAGES (", imgs.length, ") ===");
  const byType: Record<string, number> = {};
  for (const im of imgs) {
    const t = im.imageType ?? "null";
    byType[t] = (byType[t] ?? 0) + 1;
  }
  console.log("by imageType:", JSON.stringify(byType));
  let alicdn = 0;
  for (const im of imgs) {
    try { if (new URL(im.url).host.endsWith(".alicdn.com")) alicdn++; } catch {}
  }
  console.log("alicdn-host count:", alicdn);
  console.log("\n--- image rows (id | type | keep | variantId | host) ---");
  for (const im of imgs) {
    let host = "?";
    try { host = new URL(im.url).host; } catch {}
    console.log(`${im.id} | ${im.imageType ?? "null"} | keep=${im.keep} | var=${im.variantId ?? "—"} | ${host}`);
  }

  console.log("\n=== DESCRIPTION HTML (length", (p.descriptionHtml ?? "").length, ") ===");
  console.log((p.descriptionHtml ?? "").slice(0, 4000));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
