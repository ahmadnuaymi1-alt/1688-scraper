/**
 * Probe a URL through the REAL fetchViaBrightData (with retry logic) to confir
 * it's genuinely fetchable vs a transient flake. Read-only.
 * Env: SOURCE_URL
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

(async () => {
  const { fetchViaBrightData } = await import("../src/lib/scraper/bright-data-client");
  const url = process.env.SOURCE_URL || "https://detail.1688.com/offer/1050020297073.html";
  console.log(`Fetching via real client (with retries): ${url}`);
  const t0 = Date.now();
  try {
    const html = await fetchViaBrightData(url);
    console.log(`OK in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${html.length} bytes`);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) console.log(`title: ${titleMatch[1].slice(0, 80)}`);
  } catch (e) {
    console.error(`FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
})();
