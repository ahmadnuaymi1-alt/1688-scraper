/**
 * Parallel reapply-rules for the 5 remaining 5/28 products.
 * Fans out via Promise.all — no sequential await.
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

const REMAINING = [
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

function fmt(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 100) / 10}s`;
}

(async () => {
  const t0 = Date.now();
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
    console.error("Login failed, no session cookie");
    process.exit(1);
  }
  const cookieHeader = m[0];
  console.log(`login OK`);

  // fan out
  console.log(`firing ${REMAINING.length} reapply-rules requests in parallel...`);
  const results = await Promise.all(
    REMAINING.map(async (id) => {
      const tStart = Date.now();
      try {
        const res = await fetch(
          `http://localhost:3000/api/products/${id}/reapply-rules`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({
              categories: ["title", "description", "image"],
            }),
          },
        );
        const ms = Date.now() - tStart;
        const text = await res.text();
        return { id, ms, ok: res.ok, status: res.status, body: text.slice(0, 200) };
      } catch (err) {
        const ms = Date.now() - tStart;
        return {
          id,
          ms,
          ok: false,
          status: 0,
          body: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const totalMs = Date.now() - t0;
  console.log(`\n=== Parallel reapply-rules complete in ${fmt(totalMs)} ===`);
  for (const r of results) {
    console.log(
      `  ${r.id}  ${r.ok ? "OK" : `FAIL(${r.status})`}  ${fmt(r.ms)}${r.ok ? "" : ` — ${r.body}`}`,
    );
  }
})();
