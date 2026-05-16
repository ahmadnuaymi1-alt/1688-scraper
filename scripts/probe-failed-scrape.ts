/**
 * Fetch a 1688 URL via Bright Data and diagnose why parsePageState returned
 * null. Prints HTML length + snippets + whether expected JSON markers exist.
 *
 * Env: SOURCE_URL.
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

const SOURCE_URL = process.env.SOURCE_URL || "https://detail.1688.com/offer/992555936024.html";

async function main() {
  const token = process.env.BRIGHT_DATA_TOKEN;
  const zone = process.env.BRIGHT_DATA_ZONE;
  if (!token || !zone) {
    console.error("BRIGHT_DATA_TOKEN/ZONE not set");
    process.exit(1);
  }
  console.log(`Fetching: ${SOURCE_URL}`);
  console.log(`Zone: ${zone}`);
  const t0 = Date.now();
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ zone, url: SOURCE_URL, format: "raw" }),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} in ${elapsed}s`);
  const html = await res.text();
  console.log(`HTML length: ${html.length} bytes`);

  // Check for common error / captcha markers
  const markers = [
    ["captcha", /captcha/i],
    ["verification", /verify|verification|punish/i],
    ["title <title>...</title>", /<title>([^<]+)<\/title>/],
    ['offerTitle in JSON', /"offerTitle"\s*:/],
    ['subject in JSON', /"subject"\s*:/],
    ['skuProps in JSON', /"skuProps"\s*:/],
    ['"data":', /"data"\s*:\s*\{/],
    ['__INITIAL_DATA__', /__INITIAL_DATA__|window\._DATA|page-data/],
    ['error page indicator', /商品不存在|商品已删除|页面找不到|404|not found|removed|expired/i],
  ];
  console.log("\nMarker checks:");
  for (const [label, re] of markers) {
    const m = html.match(re as RegExp);
    if (m) {
      const snippet = (m[1] || m[0]).slice(0, 200).replace(/\s+/g, " ");
      console.log(`  ✓ ${label}: "${snippet}"`);
    } else {
      console.log(`  ✗ ${label}`);
    }
  }

  // Look for any JSON-like blocks that contain product data
  console.log("\nFirst 500 chars of HTML:");
  console.log(html.slice(0, 500));
  console.log("\nLast 500 chars:");
  console.log(html.slice(-500));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
