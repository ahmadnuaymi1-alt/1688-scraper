/**
 * Wipe all hero / hero-flat ProductImage rows for the two step-light
 * products the user flagged for redo, then re-spawn the bulk hero script
 * which now has dHash perceptual dedup so visually-identical supplier
 * photos collapse to a single hero.
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
];

const prisma = new PrismaClient();
const supabase = (() => {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
})();

async function wipeProductHeroes(productId: string): Promise<number> {
  const heroes = await prisma.productImage.findMany({
    where: { productId, imageType: { in: ["hero", "hero-flat"] } },
    select: { id: true, storagePath: true },
  });
  if (heroes.length === 0) return 0;
  await prisma.variant.updateMany({
    where: { productId, featuredImageId: { in: heroes.map((h) => h.id) } },
    data: { featuredImageId: null },
  });
  const paths = heroes.map((h) => h.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) console.warn(`  storage rm warn: ${error.message}`);
  }
  const r = await prisma.productImage.deleteMany({ where: { id: { in: heroes.map((h) => h.id) } } });
  return r.count;
}

function spawnBulk(productIds: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_hf-cli-bulk-heroes.ts", "--products", productIds.join(",")],
      { stdio: "inherit", shell: true },
    );
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => { console.error(`spawn: ${err.message}`); resolve(-1); });
  });
}

(async () => {
  const t0 = Date.now();
  for (const id of PRODUCT_IDS) {
    const n = await wipeProductHeroes(id);
    console.log(`Wiped ${n} hero row(s) for ${id}`);
  }
  console.log(`\nSpawning bulk-heroes (now with dHash dedup) for ${PRODUCT_IDS.length} product(s)...\n`);
  const code = await spawnBulk(PRODUCT_IDS);
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s (exit ${code})`);
  await prisma.$disconnect();
})();
