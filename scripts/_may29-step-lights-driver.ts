/**
 * 5/29/2026 step-light batch driver — 4 products.
 *   Phase A  bulk heroes via _hf-cli-bulk-heroes.ts (parallel, 1 invocation)
 *   Phase B  lifestyles per product via _lifestyle-image-creator.ts (sequential)
 *   Phase C  close-ups via _hf-cli-bulk-closeups.ts (parallel, 1 invocation)
 *   Phase D  applyGalleryPreset via /api/products/{id}/apply-gallery-preset (parallel)
 *
 * Sequential lifestyles is the documented exception (each call drives 6
 * concurrent Higgsfield generations internally). Everything else fans out.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function runScript(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => { console.error(`[spawn] ${err.message}`); resolve(-1); });
  });
}

(async () => {
  const totalStart = Date.now();
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync("may29-step-lights.log", line + "\n");
  };

  log(`=== START step-lights batch (${IDS.length} products) ===`);

  // Phase A — heroes
  log(`Phase A: bulk heroes`);
  const t0 = Date.now();
  const aCode = await runScript(["scripts/_hf-cli-bulk-heroes.ts", "--products", IDS.join(",")]);
  log(`Phase A done in ${fmt(Date.now() - t0)} (exit ${aCode})`);
  if (aCode !== 0) { log("Hero phase failed — bailing."); process.exit(1); }

  // Phase B — lifestyles (per project rule: sequential per-product because
  // each call drives 6 parallel Higgsfield generations internally)
  log(`Phase B: lifestyles (single-unit, sequential per product)`);
  const bStart = Date.now();
  const bTimings: { id: string; ms: number; code: number }[] = [];
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    log(`  [${i + 1}/${IDS.length}] ${id}`);
    const t = Date.now();
    const code = await runScript(["scripts/_lifestyle-image-creator.ts", id, "--headed"]);
    const ms = Date.now() - t;
    bTimings.push({ id, ms, code });
    log(`  [${i + 1}/${IDS.length}] ${id} → ${fmt(ms)} (exit ${code})`);
  }
  log(`Phase B done in ${fmt(Date.now() - bStart)}`);

  // Phase C — closeups
  log(`Phase C: 2 close-ups per product`);
  const cStart = Date.now();
  const cCode = await runScript(["scripts/_hf-cli-bulk-closeups.ts", "--products", IDS.join(","), "--count", "2"]);
  log(`Phase C done in ${fmt(Date.now() - cStart)} (exit ${cCode})`);

  // Phase D — apply gallery preset to all 4 products in parallel
  log(`Phase D: apply gallery preset (parallel)`);
  const dStart = Date.now();
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
    log("Login failed — gallery preset must be applied manually");
  } else {
    const cookieHeader = m[0];
    const presetResults = await Promise.all(
      IDS.map(async (id) => {
        const t = Date.now();
        try {
          const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: cookieHeader },
          });
          const text = await res.text();
          return { id, ok: res.ok, ms: Date.now() - t, body: text.slice(0, 200) };
        } catch (err) {
          return { id, ok: false, ms: Date.now() - t, body: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    for (const r of presetResults) {
      log(`  ${r.id}  ${r.ok ? "OK" : "FAIL"}  ${fmt(r.ms)}${r.ok ? "" : ` — ${r.body}`}`);
    }
  }
  log(`Phase D done in ${fmt(Date.now() - dStart)}`);

  log(`\n=== TOTAL ${fmt(Date.now() - totalStart)} ===`);
})();
