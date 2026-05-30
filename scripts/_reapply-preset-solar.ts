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

(async () => {
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com",
      password: process.env.DEV_PASSWORD || "Malak2010",
    }),
  });
  const m = (loginRes.headers.get("set-cookie") || "").match(/scraper_1688_session=[^;]+/);
  if (!m) {
    console.error("Login failed");
    process.exit(1);
  }
  const res = await fetch("http://localhost:3000/api/products/cmpr76js200a9w2wof4taoa36/apply-gallery-preset", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: m[0] },
  });
  console.log(`preset: ${res.status} — ${(await res.text()).slice(0, 300)}`);
})();
