/**
 * Round every variant of the 10 latest products to the nearest whole $ ending
 * in 4 or 9 (e.g. $52 → $54, $57 → $59, $51.50 → $49 round-down). Clears
 * Variant.compareAtPrice to null on every variant.
 *
 * Logic mirrors the Vilvida _round-vilvida-prices-to-9.ts helper but with the
 * extra "4" endpoint. Candidates per decade: [tens-1, tens+4, tens+9, tens+14].
 * Tie-breaker: round UP. Floor: $4 (any sub-$4 price snaps to $4).
 *
 * Targets the LOCAL DB (these 10 products are not yet on Shopify). No external
 * API calls — just Prisma updates.
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
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PRODUCT_IDS = [
  "cmpvdwok500frw2hk9nmld4k0",
  "cmpvdvyra00dbw2hktxto64m0",
  "cmpvdvrbu00atw2hk09s9sds6",
  "cmpvdv330000jtzr0x291djgp",
  "cmpvdv27r008sw2hk94xcdomh",
  "cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes",
  "cmpvdueu50047w2hktmugaati",
  "cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];

/** Round price P (USD) to the nearest whole $ ending in 4 or 9.
 * Tie at the midpoint between 4 and 9 (e.g. $51.5) rounds UP. Clamps at $4. */
function roundTo9or4(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return p;
  const tens = Math.floor(p / 10) * 10;
  const candidates = [tens - 1, tens + 4, tens + 9, tens + 14];
  let best = candidates[1];
  let bestDist = Math.abs(p - best);
  for (const c of candidates) {
    if (c < 4) continue;
    const d = Math.abs(p - c);
    if (d < bestDist || (d === bestDist && c > best)) {
      best = c;
      bestDist = d;
    }
  }
  return Math.max(4, best);
}

interface VariantUpdate { id: string; productId: string; oldPrice: string; newPrice: string; oldCompareAt: string | null; }

(async () => {
  const prisma = new PrismaClient();
  const variants = await prisma.variant.findMany({
    where: { productId: { in: PRODUCT_IDS } },
    select: { id: true, productId: true, title: true, price: true, compareAtPrice: true },
    orderBy: [{ productId: "asc" }, { position: "asc" }],
  });
  console.log(`Found ${variants.length} variants across ${PRODUCT_IDS.length} products.\n`);

  const updates: VariantUpdate[] = [];
  for (const v of variants) {
    const oldP = parseFloat(v.price);
    const newP = roundTo9or4(oldP);
    updates.push({
      id: v.id,
      productId: v.productId,
      oldPrice: oldP.toFixed(2),
      newPrice: newP.toFixed(2),
      oldCompareAt: v.compareAtPrice,
    });
  }

  // Group by product for the report
  const byProduct = new Map<string, VariantUpdate[]>();
  for (const u of updates) {
    const arr = byProduct.get(u.productId) ?? [];
    arr.push(u);
    byProduct.set(u.productId, arr);
  }
  console.log(`Plan (sample row per product, full list below):`);
  for (const [pid, list] of byProduct) {
    const sample = list[0];
    console.log(`  ${pid}  ${list.length} variant(s)  e.g. $${sample.oldPrice} → $${sample.newPrice}  (compareAt cleared on those that had one)`);
  }

  console.log(`\nApplying updates with concurrency=8 (Prisma connection-pool friendly)…`);
  const t0 = performance.now();
  type UpdateResult = { ok: true; id: string } | { ok: false; id: string; err: string };
  const results: UpdateResult[] = new Array(updates.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= updates.length) return;
      const u = updates[i];
      try {
        await prisma.variant.update({ where: { id: u.id }, data: { price: u.newPrice, compareAtPrice: null } });
        results[i] = { ok: true, id: u.id };
      } catch (e) {
        results[i] = { ok: false, id: u.id, err: e instanceof Error ? e.message : String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, updates.length) }, () => worker()));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const compareCleared = updates.filter((u) => u.oldCompareAt != null && u.oldCompareAt !== "").length;
  console.log(`\nDone in ${Math.round(performance.now() - t0)}ms: ${ok}/${updates.length} variants updated.`);
  console.log(`compareAtPrice cleared on ${compareCleared} variant(s) that had a value.`);
  if (failed.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  ${f.id}: ${"err" in f ? f.err : ""}`);
  }
  await prisma.$disconnect();
})();
