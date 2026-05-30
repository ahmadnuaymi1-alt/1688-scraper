/**
 * ONE-OFF: Lifestyle-only generation via Kie.ai's nano-banana-pro for products
 * whose Higgsfield access was temporarily restricted. Heroes are assumed to
 * already exist (script just uses each variant's current featuredImageId as
 * the reference for cycling).
 *
 * Mirrors the lifestyle phase of scripts/_kie-pipeline-cmpijmt8z.ts — same
 * scene-override loading, same hero-pool deduping, same parallel Kie call,
 * same Supabase upload + ProductImage row (imageType="lifestyle",
 * variantId=null).
 *
 * Hard-coded to today's two products. Safe to delete after running.
 *
 * Usage: KIE_API_KEY=xxx npx tsx scripts/_kie-lifestyle-only.ts
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

const PRODUCT_IDS = [
  "cmpigm5x700erw2f00pepmyc6",
  "cmpbgppzj00wqw2ocaswxddsr",
];

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

interface KieScene { prompt: string; imageInputs: string[]; tag: string }
interface KieResult { tag: string; outputUrl: string | null; error?: string; elapsedSec: number }

async function kieGenerate(scene: KieScene): Promise<KieResult> {
  const tStart = Date.now();
  try {
    const submitRes = await fetch(KIE_CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nano-banana-pro",
        input: {
          prompt: scene.prompt,
          image_input: scene.imageInputs,
          aspect_ratio: "1:1",
          resolution: "2K",
          output_format: "png",
        },
      }),
    });
    const submit = await submitRes.json() as { code?: number; msg?: string; data?: { taskId?: string } };
    if (submit.code !== 200 || !submit.data?.taskId) {
      return { tag: scene.tag, outputUrl: null, error: `submit: ${submit.msg ?? "unknown"}`, elapsedSec: Math.round((Date.now()-tStart)/1000) };
    }
    const taskId = submit.data.taskId;
    const deadline = Date.now() + 5*60*1000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000));
      try {
        const r = await fetch(`${KIE_POLL}?taskId=${taskId}`, { headers: { Authorization: `Bearer ${KIE_KEY}` } });
        const d = await r.json() as { data?: { state?: string; resultJson?: string; failMsg?: string } };
        const state = d.data?.state;
        if (state === "success") {
          const rj = JSON.parse(d.data?.resultJson || "{}") as { resultUrls?: string[] };
          return { tag: scene.tag, outputUrl: rj.resultUrls?.[0] ?? null, elapsedSec: Math.round((Date.now()-tStart)/1000) };
        }
        if (state === "fail") {
          return { tag: scene.tag, outputUrl: null, error: d.data?.failMsg ?? "fail", elapsedSec: Math.round((Date.now()-tStart)/1000) };
        }
      } catch { /* keep polling */ }
    }
    return { tag: scene.tag, outputUrl: null, error: "timeout", elapsedSec: Math.round((Date.now()-tStart)/1000) };
  } catch (e) {
    return { tag: scene.tag, outputUrl: null, error: String(e), elapsedSec: Math.round((Date.now()-tStart)/1000) };
  }
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function safeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
}

async function runOne(productId: string, prisma: PrismaClient): Promise<{ ok: number; total: number; secs: number }> {
  const sb = getSupabase();
  console.log(`\n========================================`);
  console.log(`Product: ${productId}`);
  console.log(`========================================`);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) { console.log(`  not found`); return { ok: 0, total: 0, secs: 0 }; }
  console.log(`Title: ${product.title.slice(0, 70)}`);
  console.log(`Visible variants: ${product.variants.length}`);

  // Build hero pool — prefer hero/hero-flat via featuredImageId; fallback to
  // any variantId-linked image; final fallback to product.images[0] (so a
  // single-variant product without featuredImageId still gets a ref).
  const imagesById = new Map(product.images.map(i => [i.id, i]));
  const seen = new Set<string>();
  const heroPool: Array<{ url: string; variantPosition: number }> = [];
  for (const v of product.variants) {
    const img = (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined)
      ?? product.images.find(pi => pi.variantId === v.id)
      ?? product.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    heroPool.push({
      url: img.storagePath ? publicSupabaseUrl(img.storagePath) : (img.sourceUrl ?? ""),
      variantPosition: v.position,
    });
  }
  console.log(`Hero pool: ${heroPool.length} unique reference(s)`);
  if (heroPool.length === 0) { console.log(`  no refs — skipping`); return { ok: 0, total: 0, secs: 0 }; }

  const overridePath = path.resolve(process.cwd(), "scene-overrides", `${productId}.json`);
  if (!fs.existsSync(overridePath)) { console.log(`  no override at ${overridePath} — skipping`); return { ok: 0, total: 0, secs: 0 }; }
  const override = JSON.parse(fs.readFileSync(overridePath, "utf-8")) as { scenes: Array<{ slug?: string; prompt: string; variantSlot?: number }> };
  const scenes = override.scenes.slice(0, 6);
  console.log(`Scenes: ${scenes.length}`);

  // Fire all 6 in parallel.
  const tStart = Date.now();
  const lifeScenes: KieScene[] = scenes.map((s, i) => {
    const ref = heroPool[i % heroPool.length];
    return {
      tag: `life${i+1}_${safeSlug(s.slug || `scene-${i+1}`)}`,
      prompt: s.prompt,
      imageInputs: [ref.url],
    };
  });
  console.log(`Firing ${lifeScenes.length} Kie tasks in parallel…`);
  const results = await Promise.all(lifeScenes.map(kieGenerate));
  const ok = results.filter(r => r.outputUrl).length;
  const secs = Math.round((Date.now() - tStart) / 1000);
  console.log(`Kie returned: ${ok}/${results.length} OK in ${secs}s`);
  results.filter(r => !r.outputUrl).forEach(f => console.log(`  FAIL ${f.tag}: ${f.error}`));

  // Attach successful outputs.
  const maxPos = product.images.reduce((m, i) => Math.max(m, i.position), 0);
  let nextPos = maxPos + 1;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.outputUrl) continue;
    const slug = (scenes[i].slug && scenes[i].slug!.trim()) || `scene-${i+1}`;
    try {
      const buf = await downloadBuffer(r.outputUrl);
      const storagePath = `lifestyle/${productId}/v1_kie_${i+1}_${safeSlug(slug)}_${Date.now()}.png`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, { contentType: "image/png", upsert: false });
      if (upErr) { console.log(`  upload fail ${r.tag}: ${upErr.message}`); continue; }
      await prisma.productImage.create({
        data: {
          productId,
          variantId: null,
          imageType: "lifestyle",
          storagePath,
          sourceUrl: publicSupabaseUrl(storagePath),
          fileName: path.basename(storagePath),
          position: nextPos++,
          downloadStatus: "downloaded",
        },
      });
      console.log(`  ${r.tag} → ${storagePath} (${r.elapsedSec}s gen)`);
    } catch (e) {
      console.log(`  attach fail ${r.tag}: ${String(e)}`);
    }
  }
  return { ok, total: results.length, secs };
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  const summary: Array<{ id: string; ok: number; total: number; secs: number }> = [];
  for (const id of PRODUCT_IDS) {
    const r = await runOne(id, prisma);
    summary.push({ id, ...r });
  }
  console.log(`\n========================================`);
  console.log(`SUMMARY`);
  console.log(`========================================`);
  for (const s of summary) {
    console.log(`  ${s.id}: ${s.ok}/${s.total} in ${s.secs}s`);
  }
  console.log(`Wall clock: ${Math.round((Date.now()-t0)/1000)}s`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
