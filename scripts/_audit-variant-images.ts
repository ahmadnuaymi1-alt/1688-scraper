/**
 * READ-ONLY audit. Across all products, reports:
 *   1. Variants whose featured image would change under the size-aware
 *      re-derivation (i.e. currently mis-assigned) — wrong-image suspects.
 *   2. Hero duplication: products with >1 hero/hero-flat ProductImage row
 *      sharing the same storagePath.
 * No writes.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

async function main() {
  const { prisma } = await import("../src/lib/db");
  const { computeRederivePlan } = await import("../src/services/variant-image-rederive.service");

  const products = await prisma.product.findMany({
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  let affectedProducts = 0;
  let totalChanges = 0;
  const affected: Array<{ id: string; title: string; n: number }> = [];

  // Hero-dup scan (one query).
  const heroImgs = await prisma.productImage.findMany({
    where: { imageType: { in: ["hero", "hero-flat"] } },
    select: { productId: true, storagePath: true },
  });
  const heroDupByProduct = new Map<string, number>();
  const seen = new Map<string, Set<string>>(); // productId -> storagePaths seen
  const dupKeys = new Map<string, Set<string>>(); // productId -> dup storagePaths
  for (const h of heroImgs) {
    if (!h.storagePath) continue;
    const s = seen.get(h.productId) ?? new Set<string>();
    if (s.has(h.storagePath)) {
      const d = dupKeys.get(h.productId) ?? new Set<string>();
      d.add(h.storagePath);
      dupKeys.set(h.productId, d);
    }
    s.add(h.storagePath);
    seen.set(h.productId, s);
  }
  for (const [pid, d] of dupKeys) heroDupByProduct.set(pid, d.size);

  for (const p of products) {
    const plan = await computeRederivePlan(p.id);
    if (plan.changes.length > 0) {
      affectedProducts++;
      totalChanges += plan.changes.length;
      affected.push({ id: p.id, title: (p.title ?? "").slice(0, 50), n: plan.changes.length });
    }
  }

  console.log(`Scanned ${products.length} product(s).\n`);
  console.log(`=== WRONG-IMAGE SUSPECTS: ${affectedProducts} product(s), ${totalChanges} variant(s) ===`);
  for (const a of affected.sort((x, y) => y.n - x.n)) {
    console.log(`  ${a.n.toString().padStart(3)} variant(s)  ${a.id}  ${a.title}`);
  }
  console.log(`\n=== HERO DUPLICATION (same storagePath ≥2 hero rows): ${heroDupByProduct.size} product(s) ===`);
  for (const [pid, n] of heroDupByProduct) console.log(`  ${pid}: ${n} duplicated storagePath(s)`);
  if (heroDupByProduct.size === 0) console.log("  none — hero dedup is holding.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
