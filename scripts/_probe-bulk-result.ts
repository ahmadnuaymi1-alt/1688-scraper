/**
 * READ-ONLY: Verify the bulk-heroes run actually wrote correctly to DB. For
 * each of the 11 products, count hero rows + check every visible variant has
 * its featuredImageId pointing at a hero row.
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

const IDS = [
  "cmpjsymhx015fw2gg6zf5kp9n",
  "cmpjsx9f700thw2gg2r2kiukv",
  "cmpjsxx7n010pw2ggqsx242gf",
  "cmpjswf6e00njw2ggf8fceqtd",
  "cmpjswsmv00rfw2ggb4z2n7tb",
  "cmpjsv24600f9w2ggmzvuyfx3",
  "cmpjsvclt00j5w2ggw4yzlyw5",
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsug3l00cpw2gg1r25v59u",
  "cmpjstlof005zw2ggy9gucyhh",
  "cmpjstemm004fw2ggzp3ur3wo",
];

async function main() {
  const prisma = new PrismaClient();
  console.log("ProductID                       Visible  WithHero  HeroRows  Title");
  console.log("─".repeat(120));
  let totalVisible = 0;
  let totalWithHero = 0;
  let totalHeroRows = 0;
  for (const id of IDS) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: { where: { isHidden: false } },
        images: true,
      },
    });
    if (!p) { console.log(`  ${id}  NOT FOUND`); continue; }
    const heroRows = p.images.filter((i) => i.imageType === "hero");
    const heroIds = new Set(heroRows.map((r) => r.id));
    const variantsWithHero = p.variants.filter((v) => v.featuredImageId && heroIds.has(v.featuredImageId)).length;
    totalVisible += p.variants.length;
    totalWithHero += variantsWithHero;
    totalHeroRows += heroRows.length;
    console.log(
      `  ${id}  ${p.variants.length.toString().padStart(7)}  ${variantsWithHero.toString().padStart(8)}  ${heroRows.length.toString().padStart(8)}  ${p.title.slice(0, 50)}`,
    );
  }
  console.log("─".repeat(120));
  console.log(`  TOTAL                             ${totalVisible.toString().padStart(5)}  ${totalWithHero.toString().padStart(8)}  ${totalHeroRows.toString().padStart(8)}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
