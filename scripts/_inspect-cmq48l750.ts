/** Agent-mode inspect for cmq48l750000jw25kdq7dicq4 (jewelry box). Read-only. */
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

const PID = "cmq48l750000jw25kdq7dicq4";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";

function pub(storagePath?: string | null, sourceUrl?: string | null): string {
  if (storagePath && SUPABASE_URL) return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${storagePath}`;
  return sourceUrl ?? "";
}

(async () => {
  const p = new PrismaClient();
  try {
    const prod = await p.product.findUnique({
      where: { id: PID },
      select: {
        id: true, title: true, productType: true, optionNames: true,
        tags: true, descriptionHtml: true, pricingNotes: true,
        scrapeJob: { select: { sourceUrl: true, status: true } },
      },
    });
    if (!prod) { console.log("PRODUCT NOT FOUND"); return; }
    console.log("===== PRODUCT =====");
    console.log("title:", prod.title);
    console.log("productType:", JSON.stringify(prod.productType));
    console.log("optionNames:", JSON.stringify(prod.optionNames));
    console.log("status:", prod.scrapeJob?.status);
    console.log("sourceUrl:", prod.scrapeJob?.sourceUrl);
    console.log("tags:", JSON.stringify(prod.tags));

    const variants = await p.variant.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: {
        id: true, position: true, title: true, option1: true, option2: true,
        isHidden: true, price: true, compareAtPrice: true, weight: true, sku: true,
        featuredImageId: true,
        featuredImage: { select: { id: true, sourceUrl: true, storagePath: true } },
      },
    });
    console.log(`\n===== VARIANTS (${variants.length}) =====`);
    for (const v of variants) {
      console.log(
        `#${String(v.position).padStart(2)} ${v.isHidden ? "[HIDDEN]" : "[shown] "} ` +
        `opt1=${JSON.stringify(v.option1)} opt2=${JSON.stringify(v.option2)} ` +
        `price=${v.price} wt=${v.weight} featImg=${v.featuredImageId ?? "—"} ` +
        `title=${JSON.stringify(v.title)}`,
      );
      if (v.featuredImage) console.log(`        img: ${pub(v.featuredImage.storagePath, v.featuredImage.sourceUrl)}`);
    }

    const images = await p.productImage.findMany({
      where: { productId: PID },
      orderBy: { position: "asc" },
      select: { id: true, position: true, imageType: true, keep: true, sourceUrl: true, storagePath: true },
    });
    console.log(`\n===== PRODUCT IMAGES (${images.length}) =====`);
    const byType = new Map<string, number>();
    for (const im of images) {
      const t = im.imageType ?? "null";
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    for (const [t, n] of byType) console.log(`  ${t}: ${n}`);
    const alicdn = images.filter((im) => (im.sourceUrl ?? "").includes("alicdn"));
    console.log(`  .alicdn source rows: ${alicdn.length}`);

    console.log(`\n===== DESCRIPTION (len ${prod.descriptionHtml?.length ?? 0}) =====`);
    const stripped = (prod.descriptionHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(stripped.slice(0, 3000));

    console.log(`\n===== PRICING NOTES =====`);
    console.log(prod.pricingNotes ? String(prod.pricingNotes).slice(0, 1500) : "(none)");
  } finally {
    await p.$disconnect();
  }
})();
