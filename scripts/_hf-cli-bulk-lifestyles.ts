/**
 * Bulk lifestyle generation across N products via the official Higgsfield CLI.
 *
 * Mirrors `_hf-cli-bulk-heroes.ts` for the lifestyle pipeline: one shared
 * concurrency cap across ALL (productCount × 6) Higgsfield CLI generations.
 * Scene design (Claude) runs in parallel up-front; generation + Supabase
 * upload + DB attach interleave per scene as each one finishes.
 *
 * Usage:
 *   npx tsx scripts/_hf-cli-bulk-lifestyles.ts --products id1,id2,…
 *   npx tsx scripts/_hf-cli-bulk-lifestyles.ts --take 12
 *   npx tsx scripts/_hf-cli-bulk-lifestyles.ts --products id1,id2 --concurrency 6
 *   npx tsx scripts/_hf-cli-bulk-lifestyles.ts --products id1,id2 --dry-run
 *
 * Idempotency: a product is SKIPPED if it already has ≥1 `imageType="lifestyle"`
 * ProductImage row. Pass `--force` to generate anyway (adds 6 more on top).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { higgsfieldUpload, higgsfieldGenerate, makeLimit } from "./_higgsfield-cli";
import {
  designLifestyleScenes,
  classifyCategory,
  typeLeaf,
} from "../src/services/lifestyle-scene-designer.service";
import {
  decideUnitCounts,
  type LifestyleUnitMode,
} from "../src/services/lifestyle-unit-mix.service";

// ─────────────────────────────────────────────────────────────────────────────
// Env loader
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const REF_DIR = path.join(os.tmpdir(), "scene", "lifestyle-refs");
const COUNT_PER_PRODUCT = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  productIds: string[] | null;
  take: number;
  concurrency: number;
  multiUnit: number | null;
  multiUnitMix: boolean;
  dryRun: boolean;
  force: boolean;
}
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let productIds: string[] | null = null;
  let take = 11;
  let concurrency = 8;
  let multiUnit: number | null = null;
  let multiUnitMix = false;
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--products") {
      productIds = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--take") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) take = n;
    } else if (a === "--concurrency") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
    } else if (a === "--multi-unit") {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        multiUnit = parseInt(next, 10);
        i++;
      } else {
        multiUnit = 3;
      }
    } else if (a === "--multi-unit-mix") multiUnitMix = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
  }
  return { productIds, take, concurrency, multiUnit, multiUnitMix, dryRun, force };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prisma + Supabase singletons
// ─────────────────────────────────────────────────────────────────────────────
let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabase;
}
function publicSupabaseUrlFromPath(p: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
}
async function uploadToSupabase(buf: Buffer, storagePath: string): Promise<string> {
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(storagePath, buf, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return publicSupabaseUrlFromPath(storagePath);
}
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 60)}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}
function safeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene job — one Higgsfield generation request, tied to a product + slot
// ─────────────────────────────────────────────────────────────────────────────
interface SceneJob {
  productId: string;
  productTitle: string;
  slug: string;
  prompt: string;
  refLocal: string;       // local file path (uploaded once, cached)
  variantPosition: number;
  position: number;       // pre-reserved ProductImage.position
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-product preparation — heroes pool + scene design + reference downloads
// ─────────────────────────────────────────────────────────────────────────────
async function prepareProduct(
  productId: string,
  args: { multiUnit: number | null; multiUnitMix: boolean },
): Promise<{ jobs: SceneJob[]; title: string; reason?: string; category?: string; unitCounts?: (number | undefined)[]; mode?: LifestyleUnitMode }> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) return { jobs: [], title: productId, reason: "product not found" };

  // Build the reference pool exactly as `_lifestyle-image-creator.ts` does:
  // one entry per UNIQUE reference file across visible variants.
  const imagesById = new Map(product.images.map((img) => [img.id, img]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{
    variantId: string;
    variantPosition: number;
    variantTitle: string;
    storagePath: string;
    sourceUrl: string;
  }> = [];
  for (const v of product.variants) {
    const img =
      (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined) ??
      product.images.find((pi) => pi.variantId === v.id) ??
      product.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    heroPool.push({
      variantId: v.id,
      variantPosition: v.position,
      variantTitle: v.title,
      storagePath: img.storagePath || "",
      sourceUrl: img.storagePath ? publicSupabaseUrlFromPath(img.storagePath) : img.sourceUrl,
    });
  }
  // Variantless fallback.
  if (heroPool.length === 0 && product.variants.length === 0) {
    const variantlessHero = product.images.find(
      (img) => (img.imageType === "hero" || img.imageType === "hero-flat") && !img.variantId,
    );
    const primary = [...product.images]
      .filter((img) => img.imageType !== "hero" && img.imageType !== "hero-flat")
      .sort((a, b) => a.position - b.position)[0];
    const img = variantlessHero ?? primary;
    if (img) {
      heroPool.push({
        variantId: "",
        variantPosition: 0,
        variantTitle: product.title,
        storagePath: img.storagePath || "",
        sourceUrl: img.storagePath ? publicSupabaseUrlFromPath(img.storagePath) : img.sourceUrl,
      });
    }
  }
  if (heroPool.length === 0) {
    return { jobs: [], title: product.title, reason: "no reference image found" };
  }

  // Slot assignment. When the hero pool already contains ≥6 unique references,
  // use the first 6 directly (one variant per slot — no repeats) so the gallery
  // showcases the full range. Otherwise cycle the pool.
  const useUniquePerSlot = heroPool.length >= COUNT_PER_PRODUCT;
  const slots = Array.from({ length: COUNT_PER_PRODUCT }).map((_, i) => {
    const ref = useUniquePerSlot ? heroPool[i] : heroPool[i % heroPool.length];
    return {
      slotIndex: i,
      variantPosition: ref.variantPosition,
      variantTitle: ref.variantTitle,
      heroUrl: ref.sourceUrl,
    };
  });

  // Per-slot unit counts. CLI overrides (--multi-unit / --multi-unit-mix) win
  // first; otherwise the product's stored `lifestyleUnitMode` ("auto" by
  // default, "single" / "multi" if user has set it) feeds the policy.
  const category = classifyCategory(`${product.title} ${typeLeaf(product.productType)}`);
  const userOverridesUnitCount = args.multiUnit !== null || args.multiUnitMix;
  const productMode = (product.lifestyleUnitMode ?? "auto") as LifestyleUnitMode;
  const unitCounts: (number | undefined)[] = userOverridesUnitCount
    ? Array(COUNT_PER_PRODUCT).fill(undefined)
    : decideUnitCounts(category, COUNT_PER_PRODUCT, productId, productMode);
  const refsForDesigner = slots.map((s, i) => ({
    slotIndex: s.slotIndex,
    variantPosition: s.variantPosition,
    variantTitle: s.variantTitle,
    unitCount: unitCounts[i],
  }));

  // Ask Claude for 6 scenes.
  const designed = await designLifestyleScenes({
    productId,
    productTitle: product.title,
    productType: product.productType ?? null,
    unitCount: args.multiUnit ?? (args.multiUnitMix ? 3 : 1),
    unitCountVaried: args.multiUnitMix,
    references: refsForDesigner,
    hasSizeReference: false,
  });
  const scenes = designed.scenes;

  // Map variantPosition → slot's heroUrl.
  const heroByPos = new Map<number, string>();
  for (const slot of slots) heroByPos.set(slot.variantPosition, slot.heroUrl);

  // Pre-reserve N positions for this product.
  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  const positionBase = (maxPosRow._max.position ?? 0) + 1;

  // Download each scene's reference variant hero locally.
  const jobs: SceneJob[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const heroUrl =
      heroByPos.get(scene.variantPosition) ?? heroPool[i % heroPool.length].sourceUrl;
    const slug = `v1_lifestyle_${i + 1}_${safeSlug(scene.slug)}`;
    const refLocal = path.join(REF_DIR, `${productId}__${slug}.jpg`);
    if (!fs.existsSync(refLocal)) await downloadToFile(heroUrl, refLocal);
    jobs.push({
      productId,
      productTitle: product.title,
      slug,
      prompt: scene.prompt,
      refLocal,
      variantPosition: scene.variantPosition,
      position: positionBase + i,
    });
  }
  return { jobs, title: product.title, category, unitCounts, mode: productMode };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  console.log(`=== Higgsfield CLI bulk-lifestyles ===`);
  console.log(
    `concurrency=${args.concurrency}  dryRun=${args.dryRun}  force=${args.force}  multi-unit=${args.multiUnit ?? (args.multiUnitMix ? "mix" : 1)}\n`,
  );

  // 1. Resolve product list.
  const prisma = getPrisma();
  let products: Array<{ id: string; title: string }>;
  if (args.productIds && args.productIds.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: args.productIds } },
      select: { id: true, title: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    products = args.productIds
      .map((id) => byId.get(id))
      .filter((p): p is { id: string; title: string } => !!p);
    const missing = args.productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      console.warn(`Warning: ${missing.length} product ID(s) not found: ${missing.join(", ")}`);
    }
  } else {
    const jobs = await prisma.scrapeJob.findMany({
      where: { product: { isNot: null } },
      orderBy: { createdAt: "desc" },
      take: args.take,
      include: { product: { select: { id: true, title: true } } },
    });
    products = jobs.map((j) => j.product!).filter((p): p is { id: string; title: string } => !!p);
  }
  if (products.length === 0) {
    console.error("No products selected. Nothing to do.");
    process.exit(1);
  }

  // 2. Idempotency filter — drop products that already have a lifestyle row
  //    (unless --force).
  if (!args.force) {
    const existing = await prisma.productImage.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, imageType: "lifestyle" },
      _count: { _all: true },
    });
    const hasLifestyle = new Set(existing.map((e) => e.productId));
    const skipped = products.filter((p) => hasLifestyle.has(p.id));
    if (skipped.length > 0) {
      console.log(`Skipping ${skipped.length} product(s) that already have lifestyles:`);
      for (const p of skipped) console.log(`  ${p.id}  ${p.title.slice(0, 70)}`);
      console.log("");
    }
    products = products.filter((p) => !hasLifestyle.has(p.id));
  }
  if (products.length === 0) {
    console.log("Nothing to generate.");
    await prisma.$disconnect();
    return;
  }
  console.log(`Generating lifestyles for ${products.length} product(s):`);
  for (const p of products) console.log(`  ${p.id}  ${p.title.slice(0, 70)}`);
  console.log("");

  fs.mkdirSync(REF_DIR, { recursive: true });

  // 3. Per-product prep (scene design + ref downloads), all products in parallel.
  console.log(`Designing scenes for ${products.length} product(s) (parallel Claude calls)...`);
  const tPrep = Date.now();
  const prepLimit = makeLimit(8); // Claude rate limits are generous
  const prepResults = await Promise.all(
    products.map((p) =>
      prepLimit(async () => {
        try {
          const r = await prepareProduct(p.id, {
            multiUnit: args.multiUnit,
            multiUnitMix: args.multiUnitMix,
          });
          const mixStr = r.unitCounts ? `  mix=[${r.unitCounts.join(",")}]` : "";
          const catStr = r.category ? `  cat=${r.category}` : "";
          const modeStr = r.mode ? `  mode=${r.mode}` : "";
          console.log(
            `  ${p.id}  scenes=${r.jobs.length}${r.reason ? `  (skipped: ${r.reason})` : ""}${catStr}${modeStr}${mixStr}  ${p.title.slice(0, 50)}`,
          );
          return r;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`  ${p.id}  PREP FAIL — ${msg.slice(0, 200)}`);
          return { jobs: [], title: p.title, reason: msg };
        }
      }),
    ),
  );
  console.log(`Scene design wall: ${Math.round((Date.now() - tPrep) / 1000)}s\n`);

  // 4. Flatten all scene jobs.
  const allJobs: SceneJob[] = prepResults.flatMap((r) => r.jobs);
  console.log(`Total scene jobs to fire: ${allJobs.length} (${products.length} products × ~6 scenes)`);
  console.log(
    `Expected wall (concurrency=${args.concurrency}, ~60s/scene): ~${Math.ceil(allJobs.length / args.concurrency) * 60}s\n`,
  );
  if (args.dryRun) {
    console.log("--dry-run — exiting without firing any generation.");
    await prisma.$disconnect();
    return;
  }
  if (allJobs.length === 0) {
    console.log("Nothing to fire.");
    await prisma.$disconnect();
    return;
  }

  // 5. Shared upload cache — the same refLocal across sister-variant scenes
  //    uploads only once to Higgsfield.
  const uploadCache = new Map<string, Promise<string>>();
  const uploadOnce = (file: string): Promise<string> => {
    const cached = uploadCache.get(file);
    if (cached) return cached;
    const promise = higgsfieldUpload(file);
    uploadCache.set(file, promise);
    return promise;
  };

  // 6. Per-scene runner — upload ref → CLI generate → Supabase upload → DB attach.
  async function processScene(job: SceneJob): Promise<{ ok: boolean; sec: number; error?: string }> {
    const t0 = Date.now();
    try {
      const refUploadId = await uploadOnce(job.refLocal);
      const { imageBuffer } = await higgsfieldGenerate({
        prompt: job.prompt,
        inputUploadIds: [refUploadId],
      });
      const storagePath = `lifestyle/${job.productId}/${job.slug}.png`;
      const publicUrl = await uploadToSupabase(imageBuffer, storagePath);
      await prisma.productImage.create({
        data: {
          productId: job.productId,
          variantId: null,
          sourceUrl: publicUrl,
          storagePath,
          fileName: `${job.slug}.png`,
          altText: `Lifestyle scene — ${job.productTitle.slice(0, 80)}`,
          position: job.position,
          downloadStatus: "downloaded",
          imageType: "lifestyle",
        },
      });
      return { ok: true, sec: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      return {
        ok: false,
        sec: Math.round((Date.now() - t0) / 1000),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // 7. Fan out — single concurrency cap across all (productCount × ~6) jobs.
  console.log(`Firing ${allJobs.length} CLI generations at concurrency=${args.concurrency}...`);
  const limit = makeLimit(args.concurrency);
  const t0 = Date.now();
  const settled = await Promise.all(
    allJobs.map((job, idx) =>
      limit(async () => {
        const r = await processScene(job);
        const tag = r.ok ? "OK" : "FAIL";
        const titleHead = job.productTitle.slice(0, 32);
        console.log(
          `  [${(idx + 1).toString().padStart(2)}/${allJobs.length}] ${tag} ${r.sec}s  ${titleHead} / ${job.slug}` +
            (r.error ? `\n         ${r.error.slice(0, 200)}` : ""),
        );
        return { job, ...r };
      }),
    ),
  );
  const totalSec = Math.round((Date.now() - t0) / 1000);

  // 8. Report.
  const ok = settled.filter((r) => r.ok);
  const fail = settled.filter((r) => !r.ok);
  console.log(`\n========== TIMING REPORT ==========`);
  console.log(`Total wall: ${totalSec}s (${(totalSec / 60).toFixed(1)} min)`);
  console.log(`Scenes succeeded: ${ok.length}/${allJobs.length}`);
  console.log(`Scenes failed: ${fail.length}`);
  if (fail.length > 0) {
    console.log(`\nFailures:`);
    for (const f of fail) {
      console.log(`  ${f.job.productId} / ${f.job.slug}: ${f.error?.slice(0, 200)}`);
    }
  }
  // Per-product tally
  const byProduct = new Map<string, { ok: number; fail: number; title: string }>();
  for (const r of settled) {
    const cur = byProduct.get(r.job.productId) || { ok: 0, fail: 0, title: r.job.productTitle };
    if (r.ok) cur.ok++; else cur.fail++;
    byProduct.set(r.job.productId, cur);
  }
  console.log(`\nPer product:`);
  for (const [pid, stats] of byProduct) {
    console.log(`  ${pid}  ${stats.ok}/${stats.ok + stats.fail}  ${stats.title.slice(0, 60)}`);
  }
  console.log(`\nReview URLs:`);
  for (const pid of byProduct.keys()) {
    console.log(`  http://localhost:3000/review/${pid}`);
  }
  console.log(`====================================`);

  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
