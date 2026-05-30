/**
 * Re-run the post-scrape audit on the 5/28 batch so the new check 3a
 * (bulb-included axis strip) and check 9 (noise-spec purge) fire on them
 * retroactively. POSTs to /api/products/bulk/audit in PARALLEL (Promise.all)
 * per the bulk-ops-parallel rule.
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

const IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppv6kdl00rjw2vsnhsp6sqn",
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

(async () => {
  // login
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com",
      password: process.env.DEV_PASSWORD || "Malak2010",
    }),
  });
  const rawCookies = loginRes.headers.get("set-cookie") || "";
  const m = rawCookies.match(/scraper_1688_session=[^;]+/);
  if (!m) {
    console.error("Login failed");
    process.exit(1);
  }
  const cookieHeader = m[0];
  console.log("login OK\n");

  // Use the bulk endpoint — server-side handles the loop, single round-trip.
  const t0 = Date.now();
  const res = await fetch("http://localhost:3000/api/products/bulk/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ productIds: IDS }),
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  console.log(`bulk audit: ${res.status} in ${(elapsed / 1000).toFixed(1)}s`);
  console.log(text.slice(0, 2000));
})();
