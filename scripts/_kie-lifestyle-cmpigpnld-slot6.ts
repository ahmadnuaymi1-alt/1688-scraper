/**
 * ONE-OFF: cmpigpnld lifestyle slot 6 (boudoir-armoire-side) failed in the
 * Higgsfield batch (browser closed mid-wait). Re-generate just that single
 * scene via Kie and append it as a lifestyle ProductImage row.
 *
 * Safe to delete after running.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const KIE_KEY = process.env.KIE_API_KEY;
if (!KIE_KEY) { console.error("KIE_API_KEY not set"); process.exit(1); }

const PRODUCT_ID = "cmpigpnld00t5w2f0za0e7qgt";
const SCENE_INDEX = 5; // zero-based: 6th scene (boudoir-armoire-side)
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL = "https://api.kie.ai/api/v1/jobs/recordInfo";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function publicSupabaseUrl(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}

async function kieGenerate(prompt: string, imageInputs: string[]): Promise<string | null> {
  const submitRes = await fetch(KIE_CREATE, {
    method: "POST",
    headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "nano-banana-pro",
      input: { prompt, image_input: imageInputs, aspect_ratio: "1:1", resolution: "2K", output_format: "png" },
    }),
  });
  const submit = await submitRes.json() as { code?: number; msg?: string; data?: { taskId?: string } };
  if (submit.code !== 200 || !submit.data?.taskId) { console.error(`submit: ${submit.msg}`); return null; }
  const taskId = submit.data.taskId;
  const deadline = Date.now() + 5*60*1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const r = await fetch(`${KIE_POLL}?taskId=${taskId}`, { headers: { Authorization: `Bearer ${KIE_KEY}` } });
      const d = await r.json() as { data?: { state?: string; resultJson?: string; failMsg?: string } };
      if (d.data?.state === "success") {
        const rj = JSON.parse(d.data?.resultJson || "{}") as { resultUrls?: string[] };
        return rj.resultUrls?.[0] ?? null;
      }
      if (d.data?.state === "fail") { console.error(`fail: ${d.data?.failMsg}`); return null; }
    } catch { /* keep polling */ }
  }
  console.error("timeout");
  return null;
}

function safeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

async function main() {
  const prisma = new PrismaClient();
  const sb = getSupabase();

  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) { console.error("not found"); process.exit(1); }
  const v = product.variants[0];
  const imagesById = new Map(product.images.map(i => [i.id, i]));
  const refImg = (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined)
    ?? product.images.find(pi => pi.variantId === v.id)
    ?? product.images[0];
  if (!refImg) { console.error("no ref"); process.exit(1); }
  const refUrl = refImg.storagePath ? publicSupabaseUrl(refImg.storagePath) : (refImg.sourceUrl ?? "");
  console.log(`Reference: ${refUrl.slice(-80)}`);

  const overridePath = path.resolve(process.cwd(), "scene-overrides", `${PRODUCT_ID}.json`);
  const override = JSON.parse(fs.readFileSync(overridePath, "utf-8")) as { scenes: Array<{ slug?: string; prompt: string }> };
  const scene = override.scenes[SCENE_INDEX];
  if (!scene) { console.error(`scene ${SCENE_INDEX} not found`); process.exit(1); }
  console.log(`Scene: ${scene.slug}`);

  console.log(`Firing Kie…`);
  const tStart = Date.now();
  const outputUrl = await kieGenerate(scene.prompt, [refUrl]);
  if (!outputUrl) { console.error("no output"); process.exit(1); }
  const secs = Math.round((Date.now() - tStart) / 1000);
  console.log(`Got output in ${secs}s: ${outputUrl.slice(0, 80)}…`);

  const r = await fetch(outputUrl);
  if (!r.ok) { console.error(`download ${r.status}`); process.exit(1); }
  const buf = Buffer.from(await r.arrayBuffer());

  const slug = (scene.slug && scene.slug.trim()) || `scene-${SCENE_INDEX+1}`;
  const storagePath = `lifestyle/${PRODUCT_ID}/v1_kie_${SCENE_INDEX+1}_${safeSlug(slug)}_${Date.now()}.png`;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, { contentType: "image/png", upsert: false });
  if (upErr) { console.error(`upload: ${upErr.message}`); process.exit(1); }

  const maxPos = product.images.reduce((m, i) => Math.max(m, i.position), 0);
  const created = await prisma.productImage.create({
    data: {
      productId: PRODUCT_ID,
      variantId: null,
      imageType: "lifestyle",
      storagePath,
      sourceUrl: publicSupabaseUrl(storagePath),
      fileName: path.basename(storagePath),
      position: maxPos + 1,
      downloadStatus: "downloaded",
    },
  });
  console.log(`Attached ProductImage ${created.id} at pos ${created.position}`);
  console.log(`Review: http://localhost:3000/review/${PRODUCT_ID}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
