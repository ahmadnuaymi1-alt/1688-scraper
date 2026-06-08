/**
 * Recovery: the closeup step failed ("no usable source image") because
 * delete-originals already ran, and _hf-cli-bulk-closeups.ts only accepts a
 * source-typed (non hero/lifestyle/closeup) reference for the lead variant.
 *
 * Fix WITHOUT modifying the shared script: temporarily materialise a null-type
 * source ProductImage for the lead visible variant (#1), cloned from its
 * hero-flat image, so the closeup script's `refImg` fallback picks it up. Then
 * invoke the closeup script (--count 1), then delete the temp source row so the
 * gallery end-state is clean (hero-flat + lifestyle + closeup only).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
const BUCKET = process.env.SUPABASE_BUCKET ?? process.env.SUPABASE_STORAGE_BUCKET ?? "product-images";
const TEMP_STORAGE = `${PID}/_tmp-closeup-ref-lead.png`;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function publicUrl(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}

(async () => {
  const prisma = new PrismaClient();
  let tempId: string | null = null;
  try {
    // Already have a closeup? Skip.
    const existingClose = await prisma.productImage.count({ where: { productId: PID, imageType: "closeup" } });
    if (existingClose > 0) { console.log(`Already ${existingClose} closeup(s) — skipping.`); return; }

    const lead = await prisma.variant.findFirst({
      where: { productId: PID, isHidden: false }, orderBy: { position: "asc" },
      select: { id: true, position: true, featuredImageId: true, option1: true,
        featuredImage: { select: { storagePath: true, sourceUrl: true } } },
    });
    if (!lead?.featuredImage) throw new Error("lead variant has no featured (hero) image");
    console.log(`Lead variant #${lead.position} ${lead.option1}`);

    const heroUrl = lead.featuredImage.storagePath ? publicUrl(lead.featuredImage.storagePath) : lead.featuredImage.sourceUrl!;
    const res = await fetch(heroUrl);
    if (!res.ok) throw new Error(`download hero ${res.status} ${heroUrl}`);
    const buf = Buffer.from(await res.arrayBuffer());

    const { error } = await getSupabase().storage.from(BUCKET).upload(TEMP_STORAGE, buf, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`temp upload failed: ${error.message}`);

    const maxPos = await prisma.productImage.aggregate({ where: { productId: PID }, _max: { position: true } });
    const temp = await prisma.productImage.create({
      data: {
        productId: PID, variantId: lead.id, position: (maxPos._max.position ?? 0) + 1,
        imageType: null, sourceUrl: publicUrl(TEMP_STORAGE), storagePath: TEMP_STORAGE, keep: false,
        downloadStatus: "downloaded",
      },
      select: { id: true },
    });
    tempId = temp.id;
    console.log(`Created temp null-type source ${temp.id.slice(-8)} for lead variant (from hero-flat).`);

    // Run the shared closeup script (count 1) — it will pick the temp source.
    console.log("Running _hf-cli-bulk-closeups.ts --count 1 ...");
    const r = spawnSync("npx", ["tsx", "scripts/_hf-cli-bulk-closeups.ts", "--products", PID, "--count", "1"], {
      stdio: "inherit", shell: true, env: { ...process.env, HIGGSFIELD_MAX_INFLIGHT: process.env.HIGGSFIELD_MAX_INFLIGHT ?? "8" },
    });
    console.log(`closeup script exit=${r.status}`);
  } finally {
    if (tempId) {
      try {
        await prisma.productImage.delete({ where: { id: tempId } });
        await getSupabase().storage.from(BUCKET).remove([TEMP_STORAGE]);
        console.log("Cleaned up temp source row + storage object.");
      } catch (e) { console.log(`cleanup warn: ${e instanceof Error ? e.message : e}`); }
    }
    const close = await prisma.productImage.count({ where: { productId: PID, imageType: "closeup" } });
    console.log(`Final closeup count: ${close}`);
    await prisma.$disconnect();
  }
})();
