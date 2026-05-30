/**
 * Wipe existing lifestyle ProductImage rows for the 4 step-light products
 * and re-fire the lifestyle generator. With the updated classifier (Chinese
 * step-light tokens → outdoor), they'll now match outdoor stair/path/garden
 * scenes instead of the pendant-default bedroom/kitchen scenes.
 *
 * Sequential per project rule (each call drives 6 parallel Higgsfield
 * generations internally). After each completes, gallery preset is applied
 * at the end across all 4 in parallel.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

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

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const PRODUCT_IDS = [
  "cmpr75j2m0085w2wo50ou3h12",
  "cmpr6s8zm001vw2wotdxrwpcb",
  "cmpr6sedo002vw2wog3u1ojmh",
  "cmpr76js200a9w2wof4taoa36",
];

const prisma = new PrismaClient();
const supabase = (() => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
})();

async function wipeLifestyles(productId: string): Promise<number> {
  const rows = await prisma.productImage.findMany({
    where: { productId, imageType: "lifestyle" },
    select: { id: true, storagePath: true },
  });
  if (rows.length === 0) return 0;
  const paths = rows.map((r) => r.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn(`  storage rm warn: ${error.message}`);
  }
  const r = await prisma.productImage.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return r.count;
}

function runScript(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...args], { stdio: "inherit", shell: true });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => { console.error(`spawn: ${err.message}`); resolve(-1); });
  });
}

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

(async () => {
  const t0 = Date.now();

  console.log(`Wiping existing lifestyles for ${PRODUCT_IDS.length} products...`);
  for (const id of PRODUCT_IDS) {
    const n = await wipeLifestyles(id);
    console.log(`  ${id}: wiped ${n} lifestyle row(s)`);
  }
  console.log("");

  console.log(`Regenerating lifestyles (sequential per project rule)...`);
  for (let i = 0; i < PRODUCT_IDS.length; i++) {
    const id = PRODUCT_IDS[i];
    console.log(`\n[${i + 1}/${PRODUCT_IDS.length}] ${id}`);
    const t = Date.now();
    const code = await runScript(["scripts/_lifestyle-image-creator.ts", id, "--headed"]);
    console.log(`[${i + 1}/${PRODUCT_IDS.length}] ${id} → ${fmt(Date.now() - t)} (exit ${code})`);
  }

  console.log(`\nApplying gallery preset to all 4 in parallel...`);
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
    console.error("Login failed — preset must be applied manually");
  } else {
    const cookie = m[0];
    const results = await Promise.all(
      PRODUCT_IDS.map(async (id) => {
        const res = await fetch(`http://localhost:3000/api/products/${id}/apply-gallery-preset`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie },
        });
        return { id, status: res.status, body: (await res.text()).slice(0, 150) };
      }),
    );
    for (const r of results) console.log(`  ${r.id} ${r.status} ${r.body}`);
  }

  console.log(`\n=== TOTAL ${fmt(Date.now() - t0)} ===`);
  await prisma.$disconnect();
})();
