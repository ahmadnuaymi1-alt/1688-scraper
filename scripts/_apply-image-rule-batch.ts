/**
 * One-off: apply the "image" rule category to the latest N products by
 * calling `reapplyRules(productId, "image")` directly. Bypasses the dev
 * server's fire-and-forget route (which dies on HMR), so the work always
 * completes.
 *
 * Usage:
 *   npx tsx scripts/_apply-image-rule-batch.ts                 # latest 13
 *   npx tsx scripts/_apply-image-rule-batch.ts --take 5
 *   npx tsx scripts/_apply-image-rule-batch.ts --products id1,id2,id3
 */
import fs from "node:fs";
import path from "node:path";
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();
import { PrismaClient } from "@prisma/client";
import { reapplyRules } from "../src/services/rule.service";

async function main() {
  const argv = process.argv.slice(2);
  let take = 13;
  let productIds: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--take" && argv[i + 1]) { take = parseInt(argv[++i], 10); }
    else if (argv[i] === "--products" && argv[i + 1]) {
      productIds = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  const prisma = new PrismaClient();

  let products: Array<{ id: string; title: string }>;
  if (productIds && productIds.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    products = productIds.map((id) => byId.get(id)).filter((p): p is { id: string; title: string } => !!p);
  } else {
    const jobs = await prisma.scrapeJob.findMany({
      where: { product: { isNot: null } },
      orderBy: { createdAt: "desc" },
      take,
      include: { product: { select: { id: true, title: true } } },
    });
    products = jobs.map((j) => j.product!).filter((p): p is { id: string; title: string } => !!p);
  }

  console.log(`Applying image rule to ${products.length} product(s):`);
  for (const p of products) console.log(`  ${p.id}  ${p.title.slice(0, 70)}`);
  console.log("");

  let ok = 0;
  let fail = 0;
  const tStart = Date.now();
  for (const p of products) {
    const t0 = Date.now();
    process.stdout.write(`  ${p.id}  ${p.title.slice(0, 50)} ... `);
    try {
      await reapplyRules(p.id, "image");
      const imageCount = await prisma.productImage.count({ where: { productId: p.id } });
      const sec = Math.round((Date.now() - t0) / 1000);
      console.log(`OK ${sec}s (renamed ${imageCount} image rows)`);
      ok++;
    } catch (e) {
      const sec = Math.round((Date.now() - t0) / 1000);
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${sec}s — ${msg.slice(0, 200)}`);
      fail++;
    }
  }
  const totalSec = Math.round((Date.now() - tStart) / 1000);
  console.log(`\nDone. ${ok}/${products.length} succeeded (${fail} failed). Wall: ${totalSec}s`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
