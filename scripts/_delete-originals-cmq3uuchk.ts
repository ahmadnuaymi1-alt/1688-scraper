/**
 * Finalize cmq3j26mt: delete originals, reapply rules, apply preset.
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

const PID = "cmq3j2mj20032w2p8arpaf42z";

(async () => {
  const prisma = new PrismaClient();

  // 1. Delete originals
  const candidates = await prisma.productImage.findMany({
    where: { productId: PID, imageType: null, keep: false },
    select: { id: true, sourceUrl: true, storagePath: true },
  });
  const originals = candidates.filter((img) => {
    try { return new URL(img.sourceUrl).hostname.endsWith(".alicdn.com"); } catch { return false; }
  });
  console.log(`Step 8: deleting ${originals.length} originals...`);
  const paths = originals.map((o) => o.storagePath).filter((p): p is string => !!p);
  if (paths.length > 0 && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "product-images").remove(paths);
  }
  await prisma.productImage.deleteMany({ where: { id: { in: originals.map((o) => o.id) } } });
  console.log(`  deleted ${originals.length} ProductImage rows`);

  // 2. Reapply rules
  console.log(`Step 9: reapplying rules...`);
  const { reapplyRules } = await import("../src/services/rule.service");
  await reapplyRules(PID, ["description", "image", "title", "tags", "seo"]);
  console.log("  rules applied");

  // 3. Apply gallery preset
  console.log(`Step 9.5: applying gallery preset...`);
  const { applyGalleryPreset } = await import("../src/services/gallery-preset.service");
  const presetResult = await applyGalleryPreset(PID);
  console.log(`  preset: total=${presetResult.totalImages} lead=${presetResult.leadHeroImageId?.slice(-8) ?? "—"} life=${presetResult.lifestyleCount} trailing=${presetResult.trailingHeroCount}`);

  await prisma.$disconnect();
  console.log(`DONE: /review/${PID}`);
})();
