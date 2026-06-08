/**
 * Trim doubled lifestyle ProductImage rows back to the override's scene count
 * (keeps the lowest-position N, deletes the rest from DB + storage best-effort).
 * Caused by a re-run colliding with a still-alive orphan tail. Idempotent / no-op
 * when the count already matches.
 *   npx tsx scripts/_speedtest-trim-lifestyles.ts <productId> [targetCount]
 */
import fs from "node:fs";
import path from "node:path";
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

const PID = process.argv[2];

async function main() {
  if (!PID) throw new Error("usage: _speedtest-trim-lifestyles.ts <productId> [targetCount]");
  let target = parseInt(process.argv[3], 10);
  if (!Number.isFinite(target)) {
    // default: number of scenes in the override file
    const f = `scene-overrides/${PID}.json`;
    target = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")).scenes?.length ?? 6) : 6;
  }
  const prisma = new PrismaClient();
  const rows = await prisma.productImage.findMany({
    where: { productId: PID, imageType: "lifestyle" },
    select: { id: true, storagePath: true, position: true },
    orderBy: { position: "asc" },
  });
  console.log(`lifestyle rows=${rows.length}, target=${target}`);
  if (rows.length <= target) { console.log("no trim needed"); await prisma.$disconnect(); return; }
  const toDelete = rows.slice(target); // keep first `target` by position
  const paths = toDelete.map((r) => r.storagePath).filter((p): p is string => !!p);
  if (paths.length) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
      await supabase.storage.from(bucket).remove(paths);
    } catch (e) { console.warn("storage remove (non-fatal):", e instanceof Error ? e.message : e); }
  }
  const res = await prisma.productImage.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
  console.log(`deleted ${res.count} excess lifestyle rows → ${target} remain`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
