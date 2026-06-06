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
const IDS = ["cmpwtdpb5005uw29gk3uft7k8", "cmpwtdkke003yw29gb0h63g82"];
(async () => {
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  console.log(`Pricing ${IDS.length} products in parallel…`);
  const t0 = performance.now();
  const out = await Promise.all(IDS.map(async (id) => {
    const t = performance.now();
    try {
      const r = await recalculatePricing(id, DEFAULT_SCRAPE_OPTIONS);
      await applyPricingToVariants(id, "launch", DEFAULT_SCRAPE_OPTIONS);
      const launch = r.ladder.find((t) => t.label === "launch")?.price;
      const stretch = r.ladder.find((t) => t.label === "stretch")?.price;
      const compareAt = r.ladder.find((t) => t.label === "compareAt")?.price;
      const landed = r.landedCostBreakdown?.landedUSD;
      const ms = Math.round(performance.now() - t);
      console.log(`  ✓ ${id} (${ms}ms) launch=$${launch} stretch=$${stretch} compareAt=$${compareAt ?? "—"} landed=$${landed?.toFixed(2) ?? "?"}`);
      return { id, ok: true };
    } catch (e) {
      const ms = Math.round(performance.now() - t);
      console.log(`  ✗ ${id} (${ms}ms) FAILED: ${e instanceof Error ? e.message : e}`);
      return { id, ok: false };
    }
  }));
  console.log(`Done in ${Math.round((performance.now() - t0) / 1000)}s — ${out.filter((o) => o.ok).length}/${out.length} priced.`);
})();
