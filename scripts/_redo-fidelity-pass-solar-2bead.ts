/**
 * Fidelity pass — regenerate 3 multi-unit lifestyles each for the Solar
 * Retro and 2-Bead IP65 products under the stripped-product-description
 * override files (just rewritten by two workflows). The scene-overrides
 * now contain only library-style reference-anchor language; the model
 * should no longer fight an inaccurate inline product description.
 *
 * Per the bulk-ops-parallel-not-sequential rule, both products run via
 * Promise.all + spawn.
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

const IDS = [
  "cmpsp9wh7004ww24cr1n8oeki", // Solar Retro
  "cmpsp9ppg002uw24chlb1gvmx", // 2-Bead IP65 Minimalist
];

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function wipe(prisma: PrismaClient, productId: string): Promise<number> {
  const before = await prisma.productImage.findMany({
    where: { productId, imageType: "lifestyle" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true },
  });
  if (before.length === 0) return 0;
  const result = await prisma.productImage.deleteMany({
    where: { id: { in: before.map((r) => r.id) } },
  });
  return result.count;
}

function runOne(productId: string): Promise<{ id: string; code: number; ms: number; tail: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_lifestyle-image-creator.ts", productId, "--only=3", "--no-closeup"],
      { stdio: "pipe", shell: true },
    );
    let buf = "";
    proc.stdout.on("data", (d) => { buf += d.toString(); });
    proc.stderr.on("data", (d) => { buf += d.toString(); });
    proc.on("close", (code) => {
      const tail = buf.split(/\r?\n/).slice(-20).join("\n");
      console.log(`\n--- ${productId} (exit ${code}, ${fmt(Date.now() - t)}) ---\n${tail}\n`);
      resolve({ id: productId, code: code ?? -1, ms: Date.now() - t, tail });
    });
    proc.on("error", (err) => {
      console.error(`spawn ${productId}: ${err.message}`);
      resolve({ id: productId, code: -1, ms: Date.now() - t, tail: err.message });
    });
  });
}

async function applyPreset(cookie: string, id: string) {
  const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
  });
  const body = (await res.text()).slice(0, 240);
  return { id, ok: res.ok, status: res.status, body };
}

(async () => {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log(`=== Fidelity pass: regen 3 multi-units each for ${IDS.length} products (PARALLEL) ===\n`);

  console.log(`Wipe phase:`);
  for (const id of IDS) {
    const n = await wipe(prisma, id);
    console.log(`  ${id}: wiped ${n} row(s)`);
  }

  console.log(`\nLifestyle creator phase: ${IDS.length} products in PARALLEL`);
  const lifestyleStart = Date.now();
  const results = await Promise.all(IDS.map(runOne));
  console.log(`\n=== Lifestyle phase done in ${fmt(Date.now() - lifestyleStart)} ===`);
  for (const r of results) {
    console.log(`  ${r.id}: ${fmt(r.ms)} (exit ${r.code})`);
  }

  console.log(`\n--- Re-applying gallery preset on both ---`);
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
    console.log("  Login failed — apply preset manually");
  } else {
    const cookie = m[0];
    const presetResults = await Promise.all(IDS.map((id) => applyPreset(cookie, id)));
    for (const r of presetResults) console.log(`  ${r.id} ${r.status} ${r.body}`);
  }

  console.log(`\n=== Review URLs ===`);
  for (const id of IDS) console.log(`  http://localhost:3000/review/${id}`);

  console.log(`\n=== TOTAL ${fmt(Date.now() - t0)} ===`);
  await prisma.$disconnect();
})();
