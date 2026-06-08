/**
 * Agent-mode Steps 8 → 10 for cmq3j2mj20032w2p8arpaf42z (rectangular men's quartz watch).
 *   8.   delete originals (unstarred .alicdn.com)
 *   9.   reapply rules (description, image, title, tags, seo)
 *   9.5. applyGalleryPreset
 *   10.  inspect + report
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

import { reapplyRules } from "../src/services/rule.service";
import { applyGalleryPreset } from "../src/services/gallery-preset.service";

(async () => {
  const prisma = new PrismaClient();

  // === Step 8 — delete originals ===
  console.log("\n=== Step 8 — delete originals ===");
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
  console.log(`  candidates=${candidates.length}, alicdn-originals=${originals.length}`);

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
  const delResult = await prisma.productImage.deleteMany({ where: { id: { in: originals.map((o) => o.id) } } });
  const kept = await prisma.productImage.count({ where: { productId: PID, imageType: null, keep: true } });
  console.log(`  DB deleted=${delResult.count}, kept(starred)=${kept}`);

  await prisma.$disconnect();

  // === Step 9 — reapply rules ===
  console.log("\n=== Step 9 — reapply rules (description, image, title, tags, seo) ===");
  await reapplyRules(PID, ["description", "image", "title", "tags", "seo"]);
  console.log("  reapplyRules complete");

  // === Step 9.5 — apply gallery preset ===
  console.log("\n=== Step 9.5 — applyGalleryPreset ===");
  const presetRes = await applyGalleryPreset(PID);
  console.log("  preset result:", JSON.stringify(presetRes));

  // === Step 10 — final inspect ===
  console.log("\n=== Step 10 — final inspect ===");
  const prisma2 = new PrismaClient();
  const product = await prisma2.product.findUnique({
    where: { id: PID },
    select: { id: true, title: true, productType: true, optionNames: true },
  });
  console.log("PRODUCT:", JSON.stringify(product));
  const variants = await prisma2.variant.findMany({
    where: { productId: PID },
    select: { id: true, title: true, position: true, isHidden: true, price: true, featuredImageId: true },
    orderBy: { position: "asc" },
  });
  console.log(`VARIANTS: visible=${variants.filter((v) => !v.isHidden).length}/${variants.length}`);
  for (const v of variants) {
    console.log(`  #${v.position}\thidden=${v.isHidden}\t$${v.price}\tfeat=${v.featuredImageId?.slice(-6) ?? "—"}\t${v.title}`);
  }
  const images = await prisma2.productImage.findMany({
    where: { productId: PID },
    select: { id: true, imageType: true, sourceUrl: true, position: true, keep: true },
    orderBy: { position: "asc" },
  });
  const byType = new Map<string, number>();
  for (const img of images) byType.set(img.imageType ?? "(source)", (byType.get(img.imageType ?? "(source)") ?? 0) + 1);
  console.log("IMAGE COUNTS:");
  for (const [t, n] of byType.entries()) console.log(`  ${t}: ${n}`);
  const ali = images.filter((i) => {
    try { return new URL(i.sourceUrl).hostname.endsWith(".alicdn.com"); } catch { return false; }
  });
  console.log(`ALICDN remaining: ${ali.length}`);

  await prisma2.$disconnect();
  console.log("\nReview: /review/" + PID);
})();
