/**
 * Top-up driver: add ~3 multi-unit lifestyle images to each of the 6
 * products called out in this turn. Existing lifestyles are preserved
 * (the lifestyle script is append-only — it never wipes prior lifestyles,
 * it picks position from MAX(existing)+1). `--multi-unit-mix` is passed
 * explicitly so this works for products whose Product.lifestyleUnitMode
 * is still "auto" as well as those already flagged "multi".
 *
 * Uses Promise.all to fan out all 6 products in parallel (per the
 * bulk-ops-parallel-not-sequential rule). `--only=3` limits each run to
 * 3 generated/attached scenes; `--no-closeup` skips the standard
 * auto-closeup since these products already have closeups.
 *
 * After the parallel run, re-applies the gallery preset on all 6 in
 * parallel so the new multi-unit lifestyles slot into the gallery order.
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
  "cmpspbahc00c6w24cjae7uv6j", // Iron Matte Black Conical Cage Motion Sensor (auto in DB)
  "cmpspad7h0096w24cnrxdgycr", // Marble Wall Lamp (multi in DB)
  "cmpspa7wm0075w24ccqg9mzbn", // Outdoor Linear Wall Lamp (multi in DB)
  "cmpsp9wh7004ww24cr1n8oeki", // Solar Wall Lamp (auto in DB)
  "cmpsp9ppg002uw24chlb1gvmx", // Minimalist Wall Lamp (auto in DB)
  "cmpsp94gm001nw24cpwbzd5o0", // Outdoor Crystal Wall Lamp (multi in DB)
];

const PER_PRODUCT_COUNT = 3;

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function runOne(id: string): Promise<{ id: string; code: number; ms: number; tail: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn(
      "npx",
      [
        "tsx",
        "scripts/_lifestyle-image-creator.ts",
        id,
        "--multi-unit-mix",
        `--only=${PER_PRODUCT_COUNT}`,
        "--no-closeup",
      ],
      { stdio: "pipe", shell: true },
    );
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d.toString(); });
    proc.stderr.on("data", (d) => { buf += d.toString(); });
    proc.on("close", (code) => {
      const tail = buf.split(/\r?\n/).slice(-20).join("\n");
      console.log(`\n--- ${id} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}\n`);
      resolve({ id, code: code ?? -1, ms: Date.now() - t, tail });
    });
    proc.on("error", (err) => {
      console.error(`spawn ${id}: ${err.message}`);
      resolve({ id, code: -1, ms: Date.now() - t, tail: err.message });
    });
  });
}

async function applyPreset(cookie: string, id: string) {
  const t = Date.now();
  const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
  });
  const body = (await res.text()).slice(0, 240);
  return { id, ok: res.ok, status: res.status, ms: Date.now() - t, body };
}

(async () => {
  console.log(`=== Top-up multi-unit lifestyles for ${IDS.length} products (PARALLEL) ===\n`);
  console.log(`  per-product target: ${PER_PRODUCT_COUNT} new multi-unit scenes`);
  console.log(`  existing lifestyles: preserved (append-only)`);
  console.log(`  closeups: skipped (--no-closeup)\n`);

  const t0 = Date.now();
  const results = await Promise.all(IDS.map(runOne));
  console.log(`\n=== Lifestyle phase done in ${fmt(Date.now() - t0)} ===`);
  for (const r of results) {
    console.log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);
  }

  // Re-apply gallery preset on all 6 in parallel.
  console.log(`\n--- Re-applying gallery preset on all 6 ---`);
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
    console.log("  Login failed — apply preset manually via /review/<id>");
  } else {
    const cookie = m[0];
    const presetResults = await Promise.all(IDS.map((id) => applyPreset(cookie, id)));
    for (const r of presetResults) console.log(`  ${r.id} ${r.status} ${r.body}`);
  }

  console.log(`\n=== TOTAL ${fmt(Date.now() - t0)} ===`);
})();
