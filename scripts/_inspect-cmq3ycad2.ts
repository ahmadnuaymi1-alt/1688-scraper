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

const PID = "cmq3ycad2000jw2tovgytqkld";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PID },
    select: {
      id: true,
      title: true,
      productType: true,
      optionNames: true,
      descriptionHtml: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          option1: true,
          option2: true,
          option3: true,
          isHidden: true,
          price: true,
          compareAtPrice: true,
          supplierCost: true,
          packagingDimensions: true,
          featuredImageId: true,
          featuredImage: { select: { id: true, storagePath: true, sourceUrl: true } },
        },
      },
      images: {
        select: { id: true, imageType: true, storagePath: true, keep: true, sourceUrl: true },
      },
    },
  });
  if (!p) { console.log("NOT FOUND"); return; }
  console.log("TITLE:", p.title);
  console.log("PRODUCT TYPE:", p.productType);
  console.log("OPTION NAMES:", JSON.stringify(p.optionNames));
  console.log("\nVARIANTS:", p.variants.length, " (visible:", p.variants.filter(v => !v.isHidden).length, ")");
  for (const v of p.variants) {
    console.log(
      `  #${v.position} ${v.isHidden ? "[HIDDEN]" : "[VIS]"} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" price=$${v.price} cost=${v.supplierCost ?? "?"} feat=${v.featuredImage?.sourceUrl?.slice(0, 80) ?? "NONE"}`
    );
  }
  const byType: Record<string, number> = {};
  for (const img of p.images) {
    const k = img.imageType ?? "ORIGINAL";
    byType[k] = (byType[k] ?? 0) + 1;
  }
  console.log("\nIMAGES by type:", JSON.stringify(byType));
  console.log("Total images:", p.images.length);
  console.log("\nDescriptionHTML length:", p.descriptionHtml?.length ?? 0);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
