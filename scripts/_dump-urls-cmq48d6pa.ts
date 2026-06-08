/** Dump featured-image URLs (one per style+finish, black-leather representative) for Vision review. */
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

const PID = "cmq48d6pa000jw2fw81cyt2gy";

async function main() {
  const prisma = new PrismaClient();
  const variants = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { id: true, position: true, option1: true, featuredImageId: true },
  });
  const imgIds = variants.map((v) => v.featuredImageId).filter(Boolean) as string[];
  const imgs = await prisma.productImage.findMany({
    where: { id: { in: imgIds } },
    select: { id: true, sourceUrl: true, storagePath: true },
  });
  const byId = new Map(imgs.map((i) => [i.id, i]));
  for (const v of variants) {
    const im = v.featuredImageId ? byId.get(v.featuredImageId) : null;
    console.log(`pos${v.position}\t${v.option1}\t${im?.sourceUrl ?? "NO-IMG"}`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
