/** Delete-originals for cmq3ybrqm000jw25g2h0dyzbp — mirrors the API route logic */
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

const PID = "cmq3ybrqm000jw25g2h0dyzbp";

(async () => {
  const prisma = new PrismaClient();
  try {
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
    console.log(`Found ${originals.length} originals to delete (candidates=${candidates.length})`);

    if (originals.length === 0) {
      const kept = await prisma.productImage.count({ where: { productId: PID, imageType: null, keep: true } });
      console.log(`Result: { deleted: 0, kept: ${kept} }`);
      return;
    }

    // Storage cleanup (best-effort)
    const paths = originals.map((o) => o.storagePath).filter((p): p is string => !!p);
    if (paths.length > 0) {
      try {
        const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
        if (url && key) {
          const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          const { error } = await supabase.storage.from(bucket).remove(paths);
          if (error) console.warn(`[storage] remove failed (non-fatal): ${error.message}`);
          else console.log(`[storage] removed ${paths.length} object(s)`);
        }
      } catch (err) {
        console.warn(`[storage] threw (non-fatal):`, err instanceof Error ? err.message : err);
      }
    }

    const result = await prisma.productImage.deleteMany({ where: { id: { in: originals.map((o) => o.id) } } });
    const kept = await prisma.productImage.count({ where: { productId: PID, imageType: null, keep: true } });
    console.log(`Result: { deleted: ${result.count}, kept: ${kept} }`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
