/**
 * READ-ONLY probe: dump variant/image state for the two products the user
 * just asked about, so I can decide whether the hero pipeline can run.
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
  for (const id of ["cmpigpnld00t5w2f0za0e7qgt", "cmpigm5x700erw2f00pepmyc6"]) {
    console.log("===", id, "===");
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: { orderBy: { position: "asc" } },
        images: { orderBy: { position: "asc" } },
      },
    });
    if (!p) { console.log("NOT FOUND"); continue; }
    console.log("Title:", p.title);
    console.log("Variants:", p.variants.length);
    for (const v of p.variants) {
      console.log("  v", v.position, JSON.stringify(v.title), "| featuredImageId:", v.featuredImageId, "| isHidden:", v.isHidden);
    }
    console.log("Images:", p.images.length);
    for (const i of p.images) {
      console.log("  img", i.position, "| type:", i.imageType, "| variantId:", i.variantId, "| status:", i.downloadStatus, "| id:", i.id, "| storageKey:", i.storageKey);
    }
    console.log();
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
