/**
 * READ-ONLY: probe state of cmpbgppzj before running lifestyle gen.
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

async function main() {
  const prisma = new PrismaClient();
  const p = await prisma.product.findUnique({
    where: { id: "cmpbgppzj00wqw2ocaswxddsr" },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Title:", p.title);
  console.log("Variants:", p.variants.length);
  for (const v of p.variants) {
    console.log("  v", v.position, JSON.stringify(v.title), "| featuredImageId:", v.featuredImageId, "| isHidden:", v.isHidden);
  }
  console.log("Images:", p.images.length);
  for (const i of p.images) {
    console.log("  img", i.position, "| type:", i.imageType, "| variantId:", i.variantId, "| status:", i.downloadStatus, "| id:", i.id);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
