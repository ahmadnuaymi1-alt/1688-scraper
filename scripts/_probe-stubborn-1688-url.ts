/**
 * Probe a stubborn 1688 URL via Bright Data with different formats + log
 * the raw response so we can tell if the offer is dead vs. blocked.
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

const URL = "https://detail.1688.com/offer/853066431184.html";
const token = process.env.BRIGHT_DATA_TOKEN!;
const zone = process.env.BRIGHT_DATA_ZONE!;

async function probe(format: "raw" | "json"): Promise<void> {
  console.log(`\n=== Probe format=${format} ===`);
  const t0 = Date.now();
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ zone, url: URL, format }),
  });
  const body = await res.text();
  console.log(`HTTP ${res.status} in ${Date.now() - t0}ms`);
  console.log(`Body length: ${body.length} bytes`);
  console.log(`First 500 chars: ${body.slice(0, 500)}`);
  if (body.length > 500) console.log(`Last 200 chars: ${body.slice(-200)}`);
}

(async () => {
  await probe("raw");
  await probe("json");
})();
