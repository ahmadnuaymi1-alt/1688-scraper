/**
 * Finalize the jewellery-box children: description+title rules, then per-size
 * pricing (recalculate → apply launch tier). The rawPayload was already patched
 * to each size's true CNY cost + weight, so the landed-cost floor is accurate
 * per size.
 *
 * Rules + pricing-recalc fan out via Promise.all (bulk-ops-parallel rule);
 * pricing-APPLY is sequential (shared prisma pool = connection_limit 1).
 *
 *   npx tsx scripts/_finalize-jewelry-children.ts [--phase rules|pricing|all] [--only <cid>]
 */
import fs from "node:fs";
import path from "node:path";
function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const ALL = [
  "cmpxx12260001w2yspsqfr94i", // 2-Layer
  "cmpxx130y000hw2ys0d5ikvsb", // 4-Layer
  "cmpxx161q001pw2ysta9lvk0k", // 5-Layer
  "cmpxx1854002lw2ys7vdeln6v", // 6-Layer
  "cmpxx19xo003dw2ysoykzsyhg", // 7-Layer
  "cmpxx1auc003tw2ysfupa6ih9", // 10-Layer
];

const flag = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const phase = flag("--phase") ?? "all";
const only = flag("--only");
const CHILDREN = only ? ALL.filter((c) => c === only) : ALL;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  for (let i = 0; i < 4; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ${label} attempt ${i + 1}/4 failed: ${msg.slice(0, 140)}`);
      if (i === 3) { console.error(`  ${label} GAVE UP`); return null; }
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  return null;
}

(async () => {
  const { reapplyRules } = await import("../src/services/rule.service");
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const { prisma } = await import("../src/lib/db");
  const options = { ...DEFAULT_SCRAPE_OPTIONS, suggestedPricing: true };

  if (phase === "rules" || phase === "all") {
    console.log(`\n=== RULES (description + title) — ${CHILDREN.length} child(ren), parallel ===`);
    await Promise.all(
      CHILDREN.map((cid) =>
        withRetry(`rules ${cid}`, () => reapplyRules(cid, ["description", "title"])).then(() =>
          console.log(`  ✓ rules ${cid}`),
        ),
      ),
    );
  }

  if (phase === "pricing" || phase === "all") {
    console.log(`\n=== PRICING recalc — ${CHILDREN.length} child(ren), parallel ===`);
    await Promise.all(
      CHILDREN.map((cid) =>
        withRetry(`recalc ${cid}`, () => recalculatePricing(cid, options)).then((r) => {
          if (r) {
            const floor = r.landedCostBreakdown?.floorUSD ?? null;
            console.log(`  ✓ recalc ${cid}  floor=$${floor ?? "?"}  tiers=${r.ladder.map((t) => `${t.label}:$${t.price}`).join(" ")}`);
          }
        }),
      ),
    );
    console.log(`\n=== PRICING apply (launch) — SEQUENTIAL ===`);
    for (const cid of CHILDREN) {
      await withRetry(`apply ${cid}`, () => applyPricingToVariants(cid, "launch", options));
      const vs = await prisma.variant.findMany({ where: { productId: cid }, orderBy: { position: "asc" }, select: { title: true, price: true, weight: true } });
      const prod = await prisma.product.findUnique({ where: { id: cid }, select: { title: true } });
      console.log(`  ✓ apply ${cid} "${prod?.title?.split("—").pop()?.trim()}"`);
      for (const v of vs) console.log(`       $${v.price}  (${v.weight}g)  ${v.title?.slice(0, 50)}`);
    }
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
