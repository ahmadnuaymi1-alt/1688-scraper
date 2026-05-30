/**
 * Backfill AI pricing for the 5 products from the 5/28 batch whose pricing
 * pass failed with Anthropic 429. Runs sequentially with ~3s between calls
 * so we don't re-hit the rate cap. Uses the SAME ScrapeOptions the original
 * job ran with (parsed from ScrapeJob.options) so the result matches what
 * the auto-pricing path would have produced.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { recalculatePricing, applyPricingToVariants } from "../src/services/pricing.service";
import { ScrapeOptionsSchema, DEFAULT_SCRAPE_OPTIONS } from "../src/types/scrape-options";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const prisma = new PrismaClient();

const FAILED_IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

const INTER_CALL_DELAY_MS = 3000;

(async () => {
  const t0 = Date.now();
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < FAILED_IDS.length; i++) {
    const id = FAILED_IDS[i];
    const tStart = Date.now();
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        scrapeJob: { select: { options: true } },
      },
    });
    if (!product) {
      console.warn(`[${i + 1}/${FAILED_IDS.length}] ${id} not found, skipping`);
      fail++;
      continue;
    }

    let options;
    if (product.scrapeJob?.options) {
      try {
        const parsed = JSON.parse(product.scrapeJob.options);
        options = ScrapeOptionsSchema.parse({ ...DEFAULT_SCRAPE_OPTIONS, ...parsed });
      } catch (err) {
        console.warn(`  options parse failed (${err instanceof Error ? err.message : err}) — using defaults`);
        options = ScrapeOptionsSchema.parse(DEFAULT_SCRAPE_OPTIONS);
      }
    } else {
      options = ScrapeOptionsSchema.parse(DEFAULT_SCRAPE_OPTIONS);
    }

    console.log(`[${i + 1}/${FAILED_IDS.length}] ${id} — ${(product.title ?? "").slice(0, 60)}`);
    try {
      const rationale = await recalculatePricing(id, options);
      await applyPricingToVariants(id, "launch", options);
      const launch = rationale.ladder.find((t) => t.label === "launch");
      console.log(
        `  OK in ${Math.round((Date.now() - tStart) / 1000)}s — launch=${launch?.price ?? "?"}, ${rationale.ladder.length} tier(s)`,
      );
      ok++;
    } catch (err) {
      console.error(`  FAIL — ${err instanceof Error ? err.message : err}`);
      fail++;
    }
    if (i < FAILED_IDS.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_CALL_DELAY_MS));
    }
  }

  const totalSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== Backfill complete: ${ok} OK, ${fail} FAIL in ${totalSec}s ===`);
  await prisma.$disconnect();
})();
