/**
 * Non-destructive probe for the new dimension extraction.
 *
 * Fetches a 1688 URL via Bright Data, runs it through `parsePageState`, and
 * reports:
 *   - Did the Specifications regex find a valid product-level dimension string?
 *   - Did the Packing-section parser find any per-variant L×W×H rows?
 *
 * Pure dry-run — no DB writes, no AI calls. Cost: 1 Bright Data fetch.
 *
 * Env: SOURCE_URL (defaults to the UFO lamp).
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const SOURCE_URL = process.env.SOURCE_URL || "https://detail.1688.com/offer/992555936024.html";

async function main() {
  const token = process.env.BRIGHT_DATA_TOKEN;
  const zone = process.env.BRIGHT_DATA_ZONE;
  if (!token || !zone) {
    console.error("BRIGHT_DATA_TOKEN/ZONE not set in .env.local");
    process.exit(1);
  }

  console.log(`Fetching: ${SOURCE_URL}`);
  const t0 = Date.now();
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ zone, url: SOURCE_URL, format: "raw" }),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} in ${elapsed}s`);
  const html = await res.text();
  console.log(`HTML length: ${html.length} bytes\n`);

  const offerId = (SOURCE_URL.match(/offer\/(\d+)\.html/)?.[1]) ?? "0";
  const { parsePageState } = await import("../src/lib/scraper/page-state-parser.js");
  const parsed = parsePageState(html, offerId);
  if (!parsed) {
    console.error("parsePageState returned null — page state JSON not found");
    process.exit(1);
  }

  console.log("=== Specifications-section dimension ===");
  if (parsed.productPackagingDimensions) {
    console.log(`  ✓ "${parsed.productPackagingDimensions}"`);
  } else {
    console.log("  • (none found)");
  }

  console.log("\n=== Packing-section per-variant rows ===");
  const rows = parsed.packingDimensionsRows ?? [];
  if (rows.length === 0) {
    console.log("  • (no packing table rows parsed)");
  } else {
    for (const r of rows) {
      const dim = [r.lengthCm, r.widthCm, r.heightCm]
        .map((n) => (n === null ? "-" : String(n)))
        .join(" × ");
      console.log(`  ${r.type || "(no label)"}: ${dim} cm   weight: ${r.weightG ?? "-"} g`);
    }
  }

  console.log("");
  const hasDim = !!parsed.productPackagingDimensions || rows.some((r) =>
    [r.lengthCm, r.widthCm, r.heightCm].some((n) => n !== null),
  );
  if (hasDim) {
    console.log(`✓ PASS — at least one dimension source returned data`);
  } else {
    console.log(`• No structured dimensions on this page. Pipeline would fall through to description-OCR / swatch-OCR.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
