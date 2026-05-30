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
  for (const id of ["cmpjsxx7n010pw2ggqsx242gf", "cmpjswf6e00njw2ggf8fceqtd"]) {
    console.log("\n===", id, "===");
    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        title: true,
        optionNames: true,
        descriptionHtml: true,
        variants: {
          where: { isHidden: false },
          orderBy: { position: "asc" },
          select: {
            position: true,
            option1: true,
            option2: true,
            option3: true,
            price: true,
            compareAtPrice: true,
          },
        },
      },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    console.log("Title:", p.title.slice(0, 70));
    console.log("optionNames:", p.optionNames);
    const html = p.descriptionHtml ?? "";
    const imgCount = (html.match(/<img/gi) ?? []).length;
    const textLen = html.replace(/<[^>]+>/g, "").trim().length;
    console.log(`descriptionHtml: ${html.length} chars / ${imgCount} <img> / ${textLen} stripped text`);
    console.log(`Visible variants: ${p.variants.length}`);
    for (const v of p.variants) {
      console.log(`  pos=${v.position} opt1="${v.option1}" opt2="${v.option2}" opt3="${v.option3}" price=${v.price} cmp=${v.compareAtPrice}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
