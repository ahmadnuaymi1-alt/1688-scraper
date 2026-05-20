/**
 * Quick read-only probe: fetch a 1688 detail page via Bright Data, run the
 * page-state parser, and print the title plus the first N image URLs. No DB
 * writes, no Shopify side effects. Used to surface a reference image for
 * downstream creative work.
 *
 * Env: SOURCE_URL (required), MAX_IMAGES (optional, default 4).
 */
import fs from "node:fs";
import path from "node:path";
import { parsePageState } from "../src/lib/scraper/page-state-parser";

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

const SOURCE_URL = process.env.SOURCE_URL;
const MAX_IMAGES = Number(process.env.MAX_IMAGES || 4);

async function main() {
  if (!SOURCE_URL) {
    console.error("SOURCE_URL not set");
    process.exit(1);
  }
  const token = process.env.BRIGHT_DATA_TOKEN;
  const zone = process.env.BRIGHT_DATA_ZONE;
  if (!token || !zone) {
    console.error("BRIGHT_DATA_TOKEN/ZONE not set");
    process.exit(1);
  }
  const offerIdMatch = SOURCE_URL.match(/\/offer\/(\d+)\.html/);
  if (!offerIdMatch) {
    console.error("Could not extract offerId from URL");
    process.exit(1);
  }
  const offerId = offerIdMatch[1];

  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ zone, url: SOURCE_URL, format: "raw" }),
  });
  if (res.status !== 200) {
    console.error(`Bright Data HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const html = await res.text();
  const parsed = parsePageState(html, offerId);
  if (!parsed) {
    console.error("parsePageState returned null");
    process.exit(1);
  }
  console.log("TITLE:", parsed.title);
  console.log("IMAGES:");
  for (const url of parsed.images.slice(0, MAX_IMAGES)) console.log(" ", url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
