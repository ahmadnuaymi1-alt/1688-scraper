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
    where: { id: "cmpjsvap800iew2ggixwlxdbn" },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  console.log("Visible variants:", p.variants.length);
  for (const v of p.variants) {
    console.log("  v", v.position, "id=", v.id.slice(-10), "featuredImageId=", v.featuredImageId, "option1=", v.option1);
  }
  console.log("Images:", p.images.length);
  for (const i of p.images) {
    console.log("  pos", i.position, "id=", i.id.slice(-10), "type=", i.imageType, "variantId=", i.variantId?.slice(-10) ?? "null");
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
