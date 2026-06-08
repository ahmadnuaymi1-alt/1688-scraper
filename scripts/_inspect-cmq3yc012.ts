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

const PRODUCT_ID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: {
      id: true, title: true, productType: true, optionNames: true,
      descriptionHtml: false,
      variants: {
        select: {
          id: true, position: true, option1: true, option2: true, option3: true,
          sku: true, price: true, supplierCost: true, isHidden: true,
          featuredImageId: true,
          featuredImage: { select: { id: true, storagePath: true, sourceUrl: true, position: true } },
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!p) { console.log("NOT FOUND"); return; }
  console.log("TITLE:", p.title);
  console.log("TYPE:", p.productType);
  console.log("OPTIONS:", p.optionNames);
  console.log("VARIANTS:", p.variants.length);
  for (const v of p.variants) {
    console.log(`  #${v.position} hidden=${v.isHidden} sku=${v.sku} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" img=${v.featuredImage?.storagePath?.slice(0, 80) ?? "NONE"}`);
  }
  await prisma.$disconnect();
}
main().catch(console.error);
