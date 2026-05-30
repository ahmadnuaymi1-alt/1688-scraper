/**
 * Verify the Check 8 OCR cache.
 *
 *   1. Run audit on a target product → first pass should be all cache misses,
 *      populates the new fields.
 *   2. Snapshot productContext.extractedSpecs.
 *   3. Run audit AGAIN → second pass should be all cache hits.
 *   4. Snapshot specs again, diff vs first snapshot — must be identical.
 *   5. Read ProductImage rows and report how many got cached.
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

const PRODUCT_ID = process.argv[2] ?? "cmpoa6ab30015w2e0q6oomwy8";

async function snapshot(prisma: PrismaClient, id: string) {
  const p = await prisma.product.findUnique({
    where: { id },
    select: { productContext: true },
  });
  const ctx = p?.productContext ? JSON.parse(p.productContext) : null;
  return JSON.stringify(ctx?.extractedSpecs ?? [], null, 2);
}

async function imageStats(prisma: PrismaClient, id: string) {
  const imgs = await prisma.productImage.findMany({
    where: { productId: id, OR: [{ imageType: null }, { imageType: "source" }] },
    select: { id: true, ocrPromptVersion: true, ocrDimsText: true },
  });
  let cached = 0;
  let nodims = 0;
  let withDims = 0;
  for (const img of imgs) {
    if (img.ocrPromptVersion) {
      cached++;
      if (img.ocrDimsText === "") nodims++;
      else withDims++;
    }
  }
  return { total: imgs.length, cached, nodims, withDims };
}

async function runAudit(id: string): Promise<void> {
  const { runPostScrapeAudit } = await import("../src/services/post-scrape-audit.service");
  await runPostScrapeAudit(id, null);
}

async function main() {
  const prisma = new PrismaClient();
  console.log(`\n=== Verifying OCR cache on ${PRODUCT_ID} ===\n`);

  console.log("[before] image stats:", await imageStats(prisma, PRODUCT_ID));

  console.log("\n--- PASS 1 (expect misses) ---");
  const t1 = Date.now();
  await runAudit(PRODUCT_ID);
  const wall1 = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`pass 1 wall time: ${wall1}s`);

  const after1 = await snapshot(prisma, PRODUCT_ID);
  console.log("[after pass 1] image stats:", await imageStats(prisma, PRODUCT_ID));

  console.log("\n--- PASS 2 (expect cache hits) ---");
  const t2 = Date.now();
  await runAudit(PRODUCT_ID);
  const wall2 = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`pass 2 wall time: ${wall2}s`);

  const after2 = await snapshot(prisma, PRODUCT_ID);
  console.log("[after pass 2] image stats:", await imageStats(prisma, PRODUCT_ID));

  console.log("\n=== SUMMARY ===");
  console.log(`pass 1: ${wall1}s | pass 2: ${wall2}s | speedup: ${(parseFloat(wall1) / parseFloat(wall2)).toFixed(1)}×`);
  if (after1 === after2) {
    console.log(`✓ specs are byte-identical between pass 1 and pass 2`);
  } else {
    console.log(`✗ SPECS DIFFER between pass 1 and pass 2 — REGRESSION`);
    console.log("\n--- pass 1 specs (first 1000 chars) ---");
    console.log(after1.slice(0, 1000));
    console.log("\n--- pass 2 specs (first 1000 chars) ---");
    console.log(after2.slice(0, 1000));
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
