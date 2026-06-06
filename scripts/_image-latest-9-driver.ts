/**
 * Imaging driver for the latest 9 products (7:43 PM batch).
 *   Phase A — bulk heroes via _hf-cli-bulk-heroes.ts (parallel internally,
 *             dHash perceptual dedup collapses near-identical supplier
 *             photos into a single hero generation).
 *   Phase B — _lifestyle-image-creator.ts for each product in PARALLEL via
 *             Promise.all + spawn. Each call internally drives 6 Higgsfield
 *             generations and then auto-spawns 1 close-up per the standard
 *             rule shipped earlier today.
 *   Phase C — gallery preset on all 9 in parallel.
 *
 * Sequential between phases; everything within a phase is parallel.
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
  "cmpspc34s00j0w24c40x2tikh", // Bauhaus Ceiling Fan
  "cmpspbp9700gew24c1kfrcek7", // Cross-Border Linear Wall Lamp (3 Size variants)
  "cmpspbahc00c6w24cjae7uv6j", // Iron Matte Black Conical Cage Motion Sensor
  "cmpspa7wm0075w24ccqg9mzbn", // Outdoor Linear Wall Lamp
  "cmpspad7h0096w24cnrxdgycr", // Marble Wall Lamp
  "cmpsp9wh7004ww24cr1n8oeki", // Solar Wall Lamp
  "cmpspuo8e00wvw24cpnxkhj62", // Outdoor Wall Lamp Hotel (6 Size variants)
  "cmpsp9ppg002uw24chlb1gvmx", // Minimalist Wall Lamp 2026
  "cmpsp94gm001nw24cpwbzd5o0", // Outdoor Crystal Wall Lamp
];

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function runScriptInherit(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => { console.error(`spawn: ${err.message}`); resolve(-1); });
  });
}

function runScriptCaptured(productId: string, args: string[]): Promise<{ id: string; code: number; ms: number; tail: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn("npx", ["tsx", ...args], { stdio: "pipe", shell: true });
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d.toString(); });
    proc.stderr.on("data", (d) => { buf += d.toString(); });
    proc.on("close", (code) => {
      const tail = buf.split(/\r?\n/).slice(-15).join("\n");
      console.log(`\n--- ${productId} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}\n`);
      resolve({ id: productId, code: code ?? -1, ms: Date.now() - t, tail });
    });
    proc.on("error", (err) => {
      console.error(`[spawn ${productId}] ${err.message}`);
      resolve({ id: productId, code: -1, ms: Date.now() - t, tail: err.message });
    });
  });
}

async function applyPreset(cookie: string, id: string) {
  const t = Date.now();
  const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
  });
  const body = (await res.text()).slice(0, 200);
  return { id, ok: res.ok, ms: Date.now() - t, body };
}

(async () => {
  const totalStart = Date.now();
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync("image-latest-9.log", line + "\n");
  };

  log(`=== START imaging driver for latest 9 products ===`);

  // Phase A — bulk heroes (parallel internally up to plan cap)
  log(`Phase A: bulk heroes (with dHash dedup)`);
  const aStart = Date.now();
  const aCode = await runScriptInherit(["scripts/_hf-cli-bulk-heroes.ts", "--products", IDS.join(",")]);
  log(`Phase A done in ${fmt(Date.now() - aStart)} (exit ${aCode})`);
  if (aCode !== 0) {
    log(`Hero phase failed — bailing.`);
    process.exit(1);
  }

  // Phase B — lifestyles for all 9 in TRUE parallel via Promise.all + spawn.
  // Each call auto-spawns 1 close-up at the end (standard rule).
  log(`Phase B: lifestyles + auto-closeup for ${IDS.length} products in PARALLEL`);
  const bStart = Date.now();
  const bResults = await Promise.all(
    IDS.map((id) => runScriptCaptured(id, ["scripts/_lifestyle-image-creator.ts", id])),
  );
  log(`Phase B done in ${fmt(Date.now() - bStart)}`);
  for (const r of bResults) log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);

  // Phase C — gallery preset on all 9 in parallel.
  log(`Phase C: gallery preset on all 9 in parallel`);
  const cStart = Date.now();
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
    const presetResults = await Promise.all(IDS.map((id) => applyPreset(cookie, id)));
    for (const r of presetResults) log(`  ${r.id} ${r.ok ? "OK" : "FAIL"} ${r.body}`);
  }
  log(`Phase C done in ${fmt(Date.now() - cStart)}`);

  log(`\n=== TOTAL ${fmt(Date.now() - totalStart)} ===`);
})();
