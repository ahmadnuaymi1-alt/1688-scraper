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

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: "cmpjswf6e00njw2ggf8fceqtd" },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  console.log("optionNames:", p.optionNames);
  console.log("\n--- ALL VISIBLE VARIANTS ---");
  for (const v of p.variants) {
    console.log(`  pos=${v.position} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" price=${v.price}`);
  }
  if (p.productContext) {
    try {
      const ctx = JSON.parse(p.productContext);
      console.log("\n--- productContext.extractedSpecs ---");
      if (Array.isArray(ctx.extractedSpecs)) {
        for (const s of ctx.extractedSpecs) console.log(`  ${s.name ?? "?"}: ${s.value ?? "?"}`);
      }
      console.log("\n--- productContext.featureCallouts ---");
      if (Array.isArray(ctx.featureCallouts)) {
        for (const c of ctx.featureCallouts.slice(0, 10)) console.log(`  ${typeof c === "string" ? c : JSON.stringify(c).slice(0, 200)}`);
      }
      console.log("\n--- productContext.supplierAttributes ---");
      if (Array.isArray(ctx.supplierAttributes)) {
        for (const s of ctx.supplierAttributes) console.log(`  ${s.name ?? "?"}: ${s.value ?? "?"}`);
      }
    } catch (e) {
      console.log("productContext parse failed");
    }
  }
  console.log("\n--- IMAGES (first 12) ---");
  for (const i of p.images.slice(0, 12)) {
    console.log(`  pos=${i.position} type=${i.imageType} variantId=${i.variantId?.slice(-8) ?? "null"} fileName=${i.fileName}`);
    console.log(`    sourceUrl: ${i.sourceUrl}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
