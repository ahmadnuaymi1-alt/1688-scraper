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
    where: { id: "cmpjswsmv00rfw2ggb4z2n7tb" },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  console.log("optionNames:", p.optionNames);
  console.log("Variants (incl hidden):", p.variants.length);
  for (const v of p.variants) {
    console.log("  v", v.position, "id=", v.id.slice(-8), "hidden=", v.isHidden, "opt1=", v.option1, "opt2=", v.option2, "opt3=", v.option3, "price=", v.price);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
