/**
 * Recovery driver after the Phase 2 crash that wiped 3 products' lifestyles.
 *
 * Phase R1 — editorial lifestyles for 3 affected products IN PARALLEL.
 *            Uses the existing scene-overrides JSONs to restore them to 6
 *            lifestyles each. All 3 fire simultaneously.
 *
 * Phase R2 — re-run lifestyle-from-lifestyle on ALL 5 products in parallel.
 *            The fixed script now generates first and only wipes the old
 *            set when at least 4 new succeed.
 *
 * Phase R3 — gallery preset across all 5 in parallel.
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

const AFFECTED = [
  "cmpr75j2m0085w2wo50ou3h12",
  "cmpr6sedo002vw2wog3u1ojmh",
  "cmpr76js200a9w2wof4taoa36",
];
const ALL_IDS = [
  "cmpr75j2m0085w2wo50ou3h12",
  "cmpr6s8zm001vw2wotdxrwpcb",
  "cmpr6sedo002vw2wog3u1ojmh",
  "cmpr76js200a9w2wof4taoa36",
  "cmpracqg800dhw2wovkxyax4d",
];

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function spawnScript(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...args], { stdio: "pipe", shell: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? -1, out }));
    proc.on("error", (err) => resolve({ code: -1, out: err.message }));
  });
}

function lastLines(s: string, n: number): string {
  return s.split(/\r?\n/).slice(-n).join("\n");
}

(async () => {
  const totalStart = Date.now();
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync("step-light-recovery.log", line + "\n");
  };

  log(`=== START recovery driver (3 affected products + new approach on 5) ===`);

  // R1 — restore editorial lifestyles for 3 affected products IN PARALLEL.
  log(`Phase R1: editorial lifestyles for ${AFFECTED.length} affected products in PARALLEL`);
  const r1Start = Date.now();
  const r1Results = await Promise.all(
    AFFECTED.map(async (id) => {
      const t = Date.now();
      const r = await spawnScript(["scripts/_lifestyle-image-creator.ts", id, "--headed"]);
      console.log(`\n--- R1 ${id} (exit ${r.code}, ${fmt(Date.now() - t)}) ---\n${lastLines(r.out, 12)}\n`);
      return { id, code: r.code, ms: Date.now() - t };
    }),
  );
  log(`Phase R1 done in ${fmt(Date.now() - r1Start)}`);
  for (const r of r1Results) log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);

  // R2 — lifestyle-from-lifestyle on ALL 5 in parallel using fixed script.
  log(`\nPhase R2: lifestyle-from-lifestyle on ${ALL_IDS.length} products in PARALLEL (fixed script)`);
  const r2Start = Date.now();
  const r2 = await spawnScript(["scripts/_lifestyle-from-lifestyle.ts", "--products", ALL_IDS.join(",")]);
  console.log(`\n--- R2 (exit ${r2.code}) ---\n${lastLines(r2.out, 20)}\n`);
  log(`Phase R2 done in ${fmt(Date.now() - r2Start)} (exit ${r2.code})`);

  // R3 — gallery preset on all 5 in parallel.
  log(`\nPhase R3: gallery preset on all 5 in parallel`);
  const r3Start = Date.now();
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
    log(`  Login failed — preset must be applied manually`);
  } else {
    const cookie = m[0];
    const presetResults = await Promise.all(
      ALL_IDS.map(async (id) => {
        const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
        });
        return { id, ok: res.ok, body: (await res.text()).slice(0, 150) };
      }),
    );
    for (const r of presetResults) log(`  ${r.id} ${r.ok ? "OK" : "FAIL"} ${r.body}`);
  }
  log(`Phase R3 done in ${fmt(Date.now() - r3Start)}`);

  log(`\n=== TOTAL recovery ${fmt(Date.now() - totalStart)} ===`);
})();
