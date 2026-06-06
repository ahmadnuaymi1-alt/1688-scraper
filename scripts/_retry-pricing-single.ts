/**
 * Retry pricing for a single product whose previous run produced unparseable
 * Claude JSON. The Claude pricing client has internal retry, but a
 * truly-malformed response will surface here; one extra attempt with the same
 * code path usually succeeds because the next sample is sampled fresh.
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

const PID = process.argv[2] ?? "cmpvdvyra00dbw2hktxto64m0";

async function main(): Promise<void> {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");

  console.log(`Retrying pricing for ${PID}…`);
  const t0 = performance.now();
  const r = await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS);
  await applyPricingToVariants(PID, "launch", DEFAULT_SCRAPE_OPTIONS);
  const launch = r.ladder.find((t) => t.label === "launch");
  const stretch = r.ladder.find((t) => t.label === "stretch");
  const compareAt = r.ladder.find((t) => t.label === "compareAt");
  const landed = r.landedCostBreakdown;
  const elapsed = Math.round((performance.now() - t0) / 100) / 10;
  console.log(`  ✓ ${PID}  (${elapsed}s)  launch=$${launch?.price}  stretch=$${stretch?.price}  compareAt=$${compareAt?.price ?? "—"}  landed=$${landed?.landedUSD?.toFixed(2) ?? "?"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
