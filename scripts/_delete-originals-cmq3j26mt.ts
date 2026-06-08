/**
 * Agent-mode Step 8: delete unstarred .alicdn.com originals for cmq3j26mt001jw2p8u0fby3x4.
 * Replicates the logic in src/app/api/products/[id]/delete-originals/route.ts
 * for headless CLI use (no auth needed at this layer).
 */
import fs from "node:fs";
import path from "node:path";
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

const PID = "cmq3j26mt001jw2p8u0fby3x4";

(async () => {
  const prisma = new PrismaClient();
  const candidates = await prisma.productImage.findMany({
    where: { productId: PID, imageType: null, keep: false },
    select: { id: true, sourceUrl: true, storagePath: true },
  });
  const originals = candidates.filter((img) => {
    try {
      const host = new URL(img.sourceUrl).hostname;
      return host.endsWith(".alicdn.com") || host === "alicdn.com";
    } catch { return false; }
  });
  console.log(`Found ${originals.length} unstarred .alicdn.com originals to delete (of ${candidates.length} imageType=null+keep=false candidates).`);

  // Storage cleanup best-effort
  const paths = originals.map((o) => o.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
    if (url && key) {
      try {
        const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error } = await supabase.storage.from(bucket).remove(paths);
        if (error) console.warn(`  storage remove non-fatal: ${error.message}`);
        else console.log(`  storage: removed ${paths.length} object(s)`);
      } catch (e) {
        console.warn(`  storage threw (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      console.log("  storage: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — skipping storage cleanup");
    }
  }

  const result = await prisma.productImage.deleteMany({ where: { id: { in: originals.map((o) => o.id) } } });
  console.log(`DB: deleted ${result.count} ProductImage row(s).`);

  const kept = await prisma.productImage.count({ where: { productId: PID, imageType: null, keep: true } });
  console.log(`Kept (starred) originals: ${kept}`);

  await prisma.$disconnect();
})();
