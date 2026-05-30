/**
 * ONE-OFF: Relabel the imageType="hero" rows just created by
 * scripts/_hf-cli-bulk-heroes.ts to imageType="hero-flat" so the review UI
 * gallery (which hides raw "hero") shows them.
 *
 * The new HERO_PROMPT was designed to produce a catalog-ready image
 * directly — running the BiRefNet-based _postprocess-heroes.ts step would
 * override the prompt's intent (#ECE6DC backdrop, 60-70% framing). Relabel
 * instead so the new-prompt output stays as the user-facing final.
 *
 * Scoped tightly: only touches the 11 product IDs from today's bulk run, and
 * only rows of imageType="hero" (leaves any older "hero-flat" rows alone).
 *
 * Safe to delete after running.
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

const PRODUCT_IDS = [
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
  const targets = await prisma.productImage.findMany({
    where: { productId: { in: PRODUCT_IDS }, imageType: "hero" },
    select: { id: true, productId: true, position: true, sourceUrl: true },
  });
  console.log(`Found ${targets.length} imageType="hero" rows across the 11 products:`);
  const byProduct = new Map<string, number>();
  for (const t of targets) {
    byProduct.set(t.productId, (byProduct.get(t.productId) ?? 0) + 1);
  }
  for (const [pid, n] of byProduct.entries()) {
    console.log(`  ${pid}  ${n}`);
  }
  if (targets.length === 0) {
    console.log("Nothing to relabel.");
    await prisma.$disconnect();
    return;
  }
  const result = await prisma.productImage.updateMany({
    where: { productId: { in: PRODUCT_IDS }, imageType: "hero" },
    data: { imageType: "hero-flat" },
  });
  console.log(`\nUpdated ${result.count} row(s) → imageType="hero-flat"`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
