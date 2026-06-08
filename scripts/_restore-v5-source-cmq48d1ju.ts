/**
 * Recovery: variant #5 (Blue Sunburst / Steel Bracelet) lost its source image —
 * its hero generation FAILED ("fetch failed") in the TAIL, so its featuredImageId
 * stayed pointed at the alicdn original, which delete-originals (running in the
 * same parallel stage) then deleted from BOTH the DB and Supabase storage. Result:
 * #5 has no image and the lifestyle script 400'd fetching its missing ref, producing
 * zero lifestyles.
 *
 * This re-uploads the locally-cached source image (.tmp-view/v5.jpg, downloaded
 * earlier in the run from the now-deleted Supabase object) and recreates a source
 * ProductImage row + sets it as #5's featuredImageId, so the hero re-run has a
 * source to work from. Idempotent-ish: skips if #5 already has a non-null featured image.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

function loadEnv(): void {
  const e = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(e)) return;
  for (const l of fs.readFileSync(e, "utf-8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/); if (!m) continue;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const PID = "cmq48d1ju000jw2gowuwbmolt";
const BUCKET = process.env.SUPABASE_BUCKET ?? "product-images";
const STORAGE_PATH = `${PID}/v5-recovered-O1CN01mv9rWs222RhljPwKS-source.jpg`;
const LOCAL = path.resolve(process.cwd(), ".tmp-view", "v5.jpg");
const ALICDN_SRC = "https://cbu01.alicdn.com/img/ibank/O1CN01mv9rWs222RhljPwKS___2200749257062-0-cib.jpg";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const v5 = await prisma.variant.findFirst({
      where: { productId: PID, position: 5 },
      select: { id: true, position: true, option1: true, featuredImageId: true },
    });
    if (!v5) throw new Error("variant #5 not found");
    if (v5.featuredImageId) {
      console.log(`Variant #5 already has featuredImageId=${v5.featuredImageId.slice(-8)} — nothing to restore.`);
      return;
    }
    if (!fs.existsSync(LOCAL)) throw new Error(`local cached source missing: ${LOCAL}`);
    const buf = fs.readFileSync(LOCAL);
    console.log(`Read local source ${LOCAL} (${buf.length} bytes)`);

    const supabase = getSupabase();
    const { error } = await supabase.storage.from(BUCKET).upload(STORAGE_PATH, buf, {
      contentType: "image/jpeg", upsert: true,
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(STORAGE_PATH);
    console.log(`Uploaded source -> ${data.publicUrl}`);

    // Determine next position
    const maxPos = await prisma.productImage.aggregate({ where: { productId: PID }, _max: { position: true } });
    const nextPos = (maxPos._max.position ?? 0) + 1;

    const created = await prisma.productImage.create({
      data: {
        productId: PID,
        variantId: v5.id,
        position: nextPos,
        imageType: null,          // source image (so hero script's group logic picks it)
        sourceUrl: ALICDN_SRC,    // original alicdn url for provenance
        storagePath: STORAGE_PATH,
        keep: false,
      },
      select: { id: true },
    });
    await prisma.variant.update({ where: { id: v5.id }, data: { featuredImageId: created.id } });
    console.log(`Created source ProductImage ${created.id.slice(-8)} at pos ${nextPos}; set as #5 featuredImageId.`);
    console.log("Done — variant #5 now has a source image for hero re-run.");
  } finally {
    await prisma.$disconnect();
  }
})();
