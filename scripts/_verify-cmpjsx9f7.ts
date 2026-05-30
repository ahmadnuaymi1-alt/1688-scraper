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
    where: { id: "cmpjsx9f700thw2gg2r2kiukv" },
    select: {
      id: true,
      title: true,
      optionNames: true,
      variants: {
        orderBy: { position: "asc" },
        select: {
          position: true,
          option1: true,
          option2: true,
          option3: true,
          isHidden: true,
          price: true,
          compareAtPrice: true,
          title: true,
        },
      },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  console.log("optionNames:", p.optionNames);
  console.log("");
  const visible = p.variants.filter((v) => !v.isHidden);
  const hidden = p.variants.filter((v) => v.isHidden);
  console.log(`Visible variants: ${visible.length}`);
  for (const v of visible) {
    console.log(
      `  pos=${v.position}  opt1="${v.option1}"  opt2="${v.option2}"  opt3="${v.option3}"  price=${v.price}  compareAt=${v.compareAtPrice}`,
    );
  }
  console.log(`\nHidden variants: ${hidden.length}`);
  for (const v of hidden.slice(0, 10)) {
    console.log(
      `  pos=${v.position}  opt1="${v.option1}"  opt2="${v.option2}"  opt3="${v.option3}"  (HIDDEN)`,
    );
  }
  if (hidden.length > 10) console.log(`  …${hidden.length - 10} more`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
