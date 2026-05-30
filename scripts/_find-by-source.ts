/**
 * Throwaway: look up products by source 1688 product ID.
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
    let v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const SOURCE_IDS = [
  "743259164195",
  "1037364133379",
  "1038678335432",
  "891975968101",
  "609075854364",
  "858305376215",
];

async function main() {
  const prisma = new PrismaClient();
  for (const sid of SOURCE_IDS) {
    const ps = await prisma.product.findMany({
      where: {
        OR: [
          { sourceUrl: { contains: sid } },
          { sourceProductId: sid },
        ],
      },
      include: {
        variants: { where: { isHidden: false } },
        images: true,
      },
    });
    if (ps.length === 0) {
      console.log(`${sid}  NOT IN DB`);
    } else {
      for (const p of ps) {
        const heroes = p.images.filter((i) => i.imageType?.startsWith("hero")).length;
        const lifes = p.images.filter((i) => i.imageType === "lifestyle").length;
        console.log(
          `${sid}  → ${p.id}  v${p.variants.length} hero:${heroes} life:${lifes}  ${p.title.slice(0, 50)}`,
        );
      }
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
