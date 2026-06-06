/**
 * Parallel lifestyle retry for the two products from the latest-9 batch
 * whose lifestyle generation failed: Solar Wall Lamp (0/6 attached) and
 * Outdoor Crystal Wall Lamp (1/6 attached). Both showed "no output file
 * — skipping DB attach" patterns earlier, consistent with a transient
 * Higgsfield rejection window during the initial batch.
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
  "cmpsp9wh7004ww24cr1n8oeki", // Solar Wall Lamp
  "cmpsp94gm001nw24cpwbzd5o0", // Outdoor Crystal Wall Lamp
];

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function runOne(id: string): Promise<{ id: string; code: number; ms: number; tail: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_lifestyle-image-creator.ts", id],
      { stdio: "pipe", shell: true },
    );
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d.toString(); });
    proc.stderr.on("data", (d) => { buf += d.toString(); });
    proc.on("close", (code) => {
      const tail = buf.split(/\r?\n/).slice(-15).join("\n");
      console.log(`\n--- ${id} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}\n`);
      resolve({ id, code: code ?? -1, ms: Date.now() - t, tail });
    });
    proc.on("error", (err) => {
      console.error(`spawn ${id}: ${err.message}`);
      resolve({ id, code: -1, ms: Date.now() - t, tail: err.message });
    });
  });
}

(async () => {
  console.log(`=== Retry lifestyles in PARALLEL for ${IDS.length} products ===\n`);
  const t0 = Date.now();
  const results = await Promise.all(IDS.map((id) => runOne(id)));
  console.log(`\n=== Retry done in ${fmt(Date.now() - t0)} ===`);
  for (const r of results) {
    console.log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);
  }

  // Re-apply gallery preset on both.
  console.log(`\n--- Re-applying gallery preset ---`);
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com",
      password: process.env.DEV_PASSWORD || "Malak2010",
    }),
  });
  const m = (loginRes.headers.get("set-cookie") || "").match(/scraper_1688_session=[^;]+/);
  if (m) {
    const cookie = m[0];
    const presetResults = await Promise.all(
      IDS.map(async (id) => {
        const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
        });
        return { id, status: res.status, body: (await res.text()).slice(0, 200) };
      }),
    );
    for (const r of presetResults) console.log(`  ${r.id} ${r.status} ${r.body}`);
  } else {
    console.log("  login failed — apply preset manually");
  }
})();
