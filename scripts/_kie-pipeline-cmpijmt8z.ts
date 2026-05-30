/**
 * ONE-OFF: Full pipeline (heroes → lifestyles) via Kie.ai's nano-banana-pro
 * endpoint, in parallel mode, with the SAME DB persistence the Higgsfield
 * wrappers do — Supabase upload + ProductImage rows + variant.featuredImageId
 * updates. Times each phase separately for comparison vs Higgsfield.
 *
 * Mirrors:
 *   - scripts/probe-hero-higgsfield-v25.ts (heroes — uses HERO_PROMPT + positioning template)
 *   - scripts/_lifestyle-image-creator.ts  (lifestyles — uses scene override + variant ref hero)
 *
 * Safe to delete after running.
 *
 * Usage: KIE_API_KEY=xxx npx tsx scripts/_kie-pipeline-cmpijmt8z.ts
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { HERO_PROMPT } from "../src/lib/hero/prompt";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const KIE_KEY = process.env.KIE_API_KEY;
if (!KIE_KEY) { console.error("KIE_API_KEY not set"); process.exit(1); }
const PRODUCT_ID = "cmpijmt8z018nw2f0g2fxwvty";
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const KIE_CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL = "https://api.kie.ai/api/v1/jobs/recordInfo";
const POSITIONING_TEMPLATE_LOCAL = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
const POSITIONING_TEMPLATE_STORAGE_PATH = "system/positioning-template.png";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function publicSupabaseUrl(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}

// ── Kie helpers ─────────────────────────────────────────────────────────────
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
    // Poll up to 5 min
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

async function main() {
  const prisma = new PrismaClient();
  const sb = getSupabase();

  // ── Step A: ensure positioning template is uploaded to Supabase ────────
  let positioningTemplateUrl = publicSupabaseUrl(POSITIONING_TEMPLATE_STORAGE_PATH);
  // Probe whether it actually exists by trying a HEAD on the URL
  const probe = await fetch(positioningTemplateUrl, { method: "HEAD" });
  if (!probe.ok) {
    if (!fs.existsSync(POSITIONING_TEMPLATE_LOCAL)) {
      console.error(`positioning template not found locally at ${POSITIONING_TEMPLATE_LOCAL}`);
      process.exit(1);
    }
    console.log(`Uploading positioning template (one-time setup)…`);
    const buf = fs.readFileSync(POSITIONING_TEMPLATE_LOCAL);
    const { error } = await sb.storage.from(BUCKET).upload(POSITIONING_TEMPLATE_STORAGE_PATH, buf, { contentType: "image/png", upsert: true });
    if (error) throw error;
    positioningTemplateUrl = publicSupabaseUrl(POSITIONING_TEMPLATE_STORAGE_PATH);
    console.log(`  → ${positioningTemplateUrl}`);
  } else {
    console.log(`Positioning template already in Supabase.`);
  }

  // ── Step B: fetch product, build heroPool ──────────────────────────────
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: { variants: { where: { isHidden: false }, orderBy: { position: "asc" } }, images: true },
  });
  if (!product) { console.error("product not found"); process.exit(1); }
  console.log(`\nProduct: ${product.title.slice(0, 60)}`);
  console.log(`Variants: ${product.variants.length}`);

  const imagesById = new Map(product.images.map(i => [i.id, i]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{ variantIds: string[]; sourceUrl: string; sourceStoragePath: string | null; key: string }> = [];
  for (const v of product.variants) {
    const img = (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined)
      ?? product.images.find(pi => pi.variantId === v.id);
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl || "";
    if (!key) continue;
    const existing = heroPool.find(h => h.key === key);
    if (existing) {
      existing.variantIds.push(v.id);
      continue;
    }
    heroPool.push({
      variantIds: [v.id],
      sourceUrl: img.storagePath ? publicSupabaseUrl(img.storagePath) : (img.sourceUrl ?? ""),
      sourceStoragePath: img.storagePath,
      key,
    });
  }
  console.log(`Unique heroes to generate: ${heroPool.length}`);

  // ── Step C: PHASE 1 — HEROES (parallel via Kie) ────────────────────────
  console.log(`\n=== PHASE 1: HEROES (${heroPool.length} unique, parallel) ===`);
  const tHeroStart = Date.now();
  const heroScenes: KieScene[] = heroPool.map((h, i) => ({
    tag: `hero${i+1}`,
    prompt: HERO_PROMPT,
    imageInputs: [h.sourceUrl, positioningTemplateUrl],
  }));
  console.log(`  Firing ${heroScenes.length} Kie tasks in parallel…`);
  const heroResults = await Promise.all(heroScenes.map(kieGenerate));
  const heroFailed = heroResults.filter(r => !r.outputUrl);
  console.log(`  Kie returned: ${heroResults.length - heroFailed.length}/${heroResults.length} OK in ${Math.round((Date.now()-tHeroStart)/1000)}s`);
  if (heroFailed.length) heroFailed.forEach(f => console.log(`    FAIL ${f.tag}: ${f.error}`));

  // ── Step D: download + upload + DB attach for each hero ────────────────
  const maxPos = product.images.reduce((m, i) => Math.max(m, i.position), 0);
  let nextPos = maxPos + 1;
  for (let i = 0; i < heroResults.length; i++) {
    const r = heroResults[i];
    if (!r.outputUrl) continue;
    const h = heroPool[i];
    const buf = await downloadBuffer(r.outputUrl);
    const storagePath = `heroes/${PRODUCT_ID}/v25_kie_${i+1}_${Date.now()}.png`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, { contentType: "image/png", upsert: false });
    if (upErr) { console.log(`    upload fail ${r.tag}: ${upErr.message}`); continue; }
    const created = await prisma.productImage.create({
      data: {
        productId: PRODUCT_ID,
        variantId: h.variantIds[0],
        imageType: "hero-flat",
        storagePath,
        sourceUrl: publicSupabaseUrl(storagePath),
        fileName: path.basename(storagePath),
        position: nextPos++,
        downloadStatus: "downloaded",
      },
    });
    // Update featuredImageId for all variants sharing this hero
    await prisma.variant.updateMany({
      where: { id: { in: h.variantIds } },
      data: { featuredImageId: created.id },
    });
    console.log(`    ${r.tag} → ${storagePath} (attached to ${h.variantIds.length} variant(s), ${r.elapsedSec}s gen)`);
  }
  const tHeroEnd = Date.now();
  const heroSecs = Math.round((tHeroEnd - tHeroStart) / 1000);
  console.log(`PHASE 1 HEROES total: ${heroSecs}s\n`);

  // ── Step E: PHASE 2 — LIFESTYLES (parallel via Kie) ────────────────────
  console.log(`=== PHASE 2: LIFESTYLES (6 scenes, parallel) ===`);
  // Reload product to pick up the new featuredImageIds
  const product2 = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: { variants: { where: { isHidden: false }, orderBy: { position: "asc" } }, images: true },
  });
  if (!product2) throw new Error("product disappeared");
  const imagesById2 = new Map(product2.images.map(i => [i.id, i]));

  // Build heroPool again, this time pointing at the new heroes
  const seenPaths2 = new Set<string>();
  const heroPool2: Array<{ url: string; variantPosition: number }> = [];
  for (const v of product2.variants) {
    const img = (v.featuredImageId ? imagesById2.get(v.featuredImageId) : undefined)
      ?? product2.images.find(pi => pi.variantId === v.id) ?? product2.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl || "";
    if (!key || seenPaths2.has(key)) continue;
    seenPaths2.add(key);
    heroPool2.push({
      url: img.storagePath ? publicSupabaseUrl(img.storagePath) : (img.sourceUrl ?? ""),
      variantPosition: v.position,
    });
  }

  const overridePath = path.resolve(process.cwd(), "scene-overrides", `${PRODUCT_ID}.json`);
  const override = JSON.parse(fs.readFileSync(overridePath, "utf-8")) as { scenes: Array<{ slug?: string; prompt: string; variantSlot?: number }> };
  const scenes = override.scenes.slice(0, 6);
  console.log(`  Loaded ${scenes.length} scenes; cycling across ${heroPool2.length} hero refs`);

  const tLifeStart = Date.now();
  const lifeScenes: KieScene[] = scenes.map((s, i) => {
    const ref = heroPool2[i % heroPool2.length];
    return {
      tag: `life${i+1}_${safeSlug(s.slug || `scene-${i+1}`)}`,
      prompt: s.prompt,
      imageInputs: [ref.url],
    };
  });
  console.log(`  Firing ${lifeScenes.length} Kie tasks in parallel…`);
  const lifeResults = await Promise.all(lifeScenes.map(kieGenerate));
  const lifeFailed = lifeResults.filter(r => !r.outputUrl);
  console.log(`  Kie returned: ${lifeResults.length - lifeFailed.length}/${lifeResults.length} OK in ${Math.round((Date.now()-tLifeStart)/1000)}s`);
  if (lifeFailed.length) lifeFailed.forEach(f => console.log(`    FAIL ${f.tag}: ${f.error}`));

  for (let i = 0; i < lifeResults.length; i++) {
    const r = lifeResults[i];
    if (!r.outputUrl) continue;
    const slug = (scenes[i].slug && scenes[i].slug!.trim()) || `scene-${i+1}`;
    const buf = await downloadBuffer(r.outputUrl);
    const storagePath = `lifestyle/${PRODUCT_ID}/v1_kie_${i+1}_${safeSlug(slug)}.png`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, { contentType: "image/png", upsert: false });
    if (upErr) { console.log(`    upload fail ${r.tag}: ${upErr.message}`); continue; }
    await prisma.productImage.create({
      data: {
        productId: PRODUCT_ID,
        variantId: null,
        imageType: "lifestyle",
        storagePath,
        sourceUrl: publicSupabaseUrl(storagePath),
        fileName: path.basename(storagePath),
        position: nextPos++,
        downloadStatus: "downloaded",
      },
    });
    console.log(`    ${r.tag} → ${storagePath} (${r.elapsedSec}s gen)`);
  }
  const tLifeEnd = Date.now();
  const lifeSecs = Math.round((tLifeEnd - tLifeStart) / 1000);
  console.log(`PHASE 2 LIFESTYLES total: ${lifeSecs}s\n`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`========== SUMMARY ==========`);
  console.log(`Heroes:     ${heroResults.filter(r => r.outputUrl).length}/${heroResults.length}  in ${heroSecs}s`);
  console.log(`Lifestyles: ${lifeResults.filter(r => r.outputUrl).length}/${lifeResults.length}  in ${lifeSecs}s`);
  console.log(`TOTAL:      ${heroSecs + lifeSecs}s (${Math.round((heroSecs+lifeSecs)/60*10)/10} min)`);
  console.log(`Review URL: http://localhost:3000/review/${PRODUCT_ID}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
