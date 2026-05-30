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
const PRODUCT_ID = "cmppqgin7004cw2vs04697sgd";

(async () => {
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      id: true,
      title: true,
      optionNames: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          title: true,
          option1: true,
          option2: true,
          option3: true,
          price: true,
          isHidden: true,
          featuredImage: { select: { sourceUrl: true, fileName: true } },
        },
      },
    },
  });
  if (!product) {
    console.log("Product not found");
    return;
  }
  console.log(`Product: ${product.title}`);
  console.log(`optionNames: ${product.optionNames}`);
  console.log(`Variants (${product.variants.length} total, ${product.variants.filter((v) => !v.isHidden).length} visible):\n`);
  for (const v of product.variants) {
    const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" / ");
    console.log(
      `  pos=${v.position}  ${v.isHidden ? "HIDDEN  " : "visible "} title="${v.title}"  opts="${opts}"  price=${v.price}`,
    );
    if (v.featuredImage) {
      console.log(`     featuredImage: ${v.featuredImage.fileName} (${v.featuredImage.sourceUrl.slice(0, 80)})`);
    }
  }
  await prisma.$disconnect();
})();
