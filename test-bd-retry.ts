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

import { fetchViaBrightData } from "@/lib/scraper/bright-data-client";

async function main() {
  const failedUrl = "https://detail.1688.com/offer/965628070024.html?";
  console.log(`Testing Bright Data fetch for ${failedUrl}`);
  
  try {
    const html = await fetchViaBrightData(failedUrl);
    console.log(`SUCCESS: fetched ${html.length} bytes`);
    console.log(`First 500 chars:\n${html.slice(0, 500)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAILED: ${msg}`);
  }
  
  process.exit(0);
}

main();
