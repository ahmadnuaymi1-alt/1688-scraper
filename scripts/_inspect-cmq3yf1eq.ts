/**
 * Inspect product cmq3yf1eq000jw2kcemhuhsp9 — full variant detail for agent-mode triage.
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

const PRODUCT_ID = "cmq3yf1eq000jw2kcemhuhsp9";

async function main() {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: {
        orderBy: { position: "asc" },
        include: {
          featuredImage: { select: { id: true, sourceUrl: true } },
        },
      },
      images: { where: { imageType: null }, select: { id: true, sourceUrl: true, position: true } },
    },
  });
  if (!product) {
    console.log("Not found");
    await prisma.$disconnect();
    return;
  }
  console.log("Title:", product.title);
  console.log("Type:", product.productType);
  console.log("OptionNames:", product.optionNames);
  console.log("descriptionHtml length:", product.descriptionHtml?.length ?? 0);
  console.log("# original product images:", product.images.length);
  console.log("\nVariants:", product.variants.length, "total");
  for (const v of product.variants) {
    console.log(
      `  pos=${v.position} hidden=${v.isHidden} opt1="${v.option1 ?? ""}" opt2="${v.option2 ?? ""}" opt3="${v.option3 ?? ""}" sku=${v.sku ?? ""} featImg=${v.featuredImage?.sourceUrl?.slice(0, 80) ?? "<none>"}`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
