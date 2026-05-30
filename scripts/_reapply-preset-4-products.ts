/**
 * Re-apply gallery preset to the 4 step-light products after the closeup
 * retry added new closeups at the end of the gallery. Fires in parallel
 * via Promise.all per the bulk-ops rule.
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

const IDS = [
  "cmpr75j2m0085w2wo50ou3h12",
  "cmpr6s8zm001vw2wotdxrwpcb",
  "cmpr6sedo002vw2wog3u1ojmh",
  "cmpr76js200a9w2wof4taoa36",
];

(async () => {
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

  const t0 = Date.now();
  const results = await Promise.all(
    IDS.map(async (id) => {
      const tStart = Date.now();
      const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookieHeader },
      });
      const text = await res.text();
      return { id, ms: Date.now() - tStart, ok: res.ok, body: text.slice(0, 200) };
    }),
  );
  const totalMs = Date.now() - t0;
  console.log(`=== Parallel preset reapply complete in ${(totalMs / 1000).toFixed(1)}s ===`);
  for (const r of results) {
    console.log(`  ${r.id}  ${r.ok ? "OK" : "FAIL"}  ${(r.ms / 1000).toFixed(1)}s${r.ok ? "" : ` — ${r.body}`}`);
  }
})();
