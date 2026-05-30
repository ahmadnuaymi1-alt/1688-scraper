/**
 * READ-ONLY: dump current ProductImage rows for cmpigm5x7 so I can confirm
 * whether the just-failed lifestyle run actually attached anything (the script
 * log was contradictory — "0/6 succeeded" but "Attached 6/6").
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
    where: { id: "cmpigm5x700erw2f00pepmyc6" },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!p) { console.log("NOT FOUND"); process.exit(0); }
  console.log("Total images:", p.images.length);
  for (const i of p.images) {
    console.log("  pos", i.position, "| type:", i.imageType, "| sourceUrl:", i.sourceUrl?.slice(-60), "| createdAt:", i.createdAt.toISOString());
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
