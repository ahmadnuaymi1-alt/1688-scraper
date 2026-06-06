/**
 * Redo-fidelity-pass driver for 4 products.
 *
 * For each product:
 *   1. Wipe the 3 most-recent ProductImage rows (imageType='lifestyle'),
 *      ordered by createdAt desc.
 *   2. Run scripts/_lifestyle-image-creator.ts <id> --only=3 --no-closeup
 *      on ALL 4 in true parallel (Promise.all + spawn).
 *   3. Re-apply gallery preset on all 4 in parallel (POST
 *      /api/products/<id>/apply-gallery-preset, with scraper_1688_session
 *      cookie obtained via /api/auth/login).
 *   4. Print review URLs.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

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

const prisma = new PrismaClient();

const IDS = [
  "cmpspbahc00c6w24cjae7uv6j",
  "cmpspad7h0096w24cnrxdgycr",
  "cmpspa7wm0075w24ccqg9mzbn",
  "cmpsp94gm001nw24cpwbzd5o0",
];

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function wipeRecentLifestyles(id: string): Promise<number> {
  const rows = await prisma.productImage.findMany({
    where: { productId: id, imageType: "lifestyle" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, fileName: true, createdAt: true },
  });
  if (rows.length === 0) {
    console.log(`  ${id}: no lifestyle rows to wipe.`);
    return 0;
  }
  const ids = rows.map((r) => r.id);
  await prisma.productImage.deleteMany({ where: { id: { in: ids } } });
  console.log(`  ${id}: wiped ${rows.length} lifestyle rows:`);
  for (const r of rows) console.log(`    - ${r.id} (${r.fileName})`);
  return rows.length;
}

function runOne(id: string): Promise<{ id: string; code: number; ms: number; tail: string; full: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn(
      "npx",
      [
        "tsx",
        "scripts/_lifestyle-image-creator.ts",
        id,
        "--only=3",
        "--no-closeup",
      ],
      { stdio: "pipe", shell: true },
    );
    let buf = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      buf += s;
      process.stdout.write(`[${id.slice(-8)}] ${s}`);
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      buf += s;
      process.stderr.write(`[${id.slice(-8)}] ${s}`);
    });
    proc.on("close", (code) => {
      const tail = buf.split(/\r?\n/).slice(-30).join("\n");
      console.log(`\n--- ${id} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}\n`);
      resolve({ id, code: code ?? -1, ms: Date.now() - t, tail, full: buf });
    });
    proc.on("error", (err) => {
      console.error(`spawn ${id}: ${err.message}`);
      resolve({ id, code: -1, ms: Date.now() - t, tail: err.message, full: err.message });
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
  console.log(`=== Redo-fidelity-pass for ${IDS.length} products (PARALLEL) ===\n`);

  const T0 = Date.now();

  // 1. Wipe the 3 most-recent lifestyles for each product.
  console.log(`--- Phase 1: wiping 3 most-recent lifestyles per product ---`);
  for (const id of IDS) {
    await wipeRecentLifestyles(id);
  }

  // 2. Run lifestyle creator on all 4 in TRUE PARALLEL.
  console.log(`\n--- Phase 2: lifestyle creator x${IDS.length} (parallel) ---`);
  const tLifestyle = Date.now();
  const results = await Promise.all(IDS.map(runOne));
  console.log(`\n=== Lifestyle phase done in ${fmt(Date.now() - tLifestyle)} ===`);
  for (const r of results) {
    console.log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);
  }

  // 3. Re-apply gallery preset on all 4 in parallel.
  console.log(`\n--- Phase 3: re-applying gallery preset on all ${IDS.length} ---`);
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

  // 4. Print review URLs.
  console.log(`\n--- Phase 4: review URLs ---`);
  for (const id of IDS) {
    console.log(`  http://localhost:3000/review/${id}`);
  }

  console.log(`\n=== TOTAL ${fmt(Date.now() - T0)} ===`);
  await prisma.$disconnect();
  process.exit(0);
})();
