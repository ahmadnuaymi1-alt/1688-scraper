/**
 * Run AI-suggested pricing on the latest 10 scraped products (the batch the
 * user just scraped that the in-scraper auto-pricing silently failed on).
 * Fires recalculatePricing + applyPricingToVariants("launch") for each in
 * parallel via Promise.all — the user has flagged sequential await-in-a-loop
 * repeatedly in memory ("bulk-ops-parallel-not-sequential").
 *
 * Uses DEFAULT_SCRAPE_OPTIONS as the options blob since the original scrape's
 * options had suggestedPricing=true and would have used those defaults anyway.
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

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;
}

async function main(): Promise<void> {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  console.log(`Pricing ${PRODUCT_IDS.length} products in parallel…\n`);
  const t0 = performance.now();

  const results = await Promise.all(
    PRODUCT_IDS.map(async (id) => {
      const tStart = performance.now();
      try {
        const rationale = await recalculatePricing(id, DEFAULT_SCRAPE_OPTIONS);
        await applyPricingToVariants(id, "launch", DEFAULT_SCRAPE_OPTIONS);
        const launch = rationale.ladder.find((t) => t.label === "launch");
        const stretch = rationale.ladder.find((t) => t.label === "stretch");
        const compareAt = rationale.ladder.find((t) => t.label === "compareAt");
        const landed = rationale.landedCostBreakdown;
        const elapsed = fmt(performance.now() - tStart);
        console.log(
          `  ✓ ${id}  (${elapsed})  launch=$${launch?.price}  stretch=$${stretch?.price}  compareAt=$${compareAt?.price ?? "—"}  landed=$${landed?.landedUSD?.toFixed(2) ?? "?"}`,
        );
        return { id, status: "OK", launch: launch?.price, stretch: stretch?.price, landed: landed?.landedUSD };
      } catch (e) {
        const elapsed = fmt(performance.now() - tStart);
        console.log(`  ✗ ${id}  (${elapsed})  FAILED: ${e instanceof Error ? e.message : e}`);
        return { id, status: "FAILED", error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const ok = results.filter((r) => r.status === "OK").length;
  const failed = results.filter((r) => r.status === "FAILED");
  console.log(`\n=== Done in ${fmt(performance.now() - t0)}: ${ok}/${PRODUCT_IDS.length} priced ===`);
  if (failed.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  ${f.id}: ${(f as { error?: string }).error}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
