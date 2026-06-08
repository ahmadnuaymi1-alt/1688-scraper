/**
 * Lifestyle Image Creator — Mode A (local DB) only.
 *
 * v3: drives the official Higgsfield CLI (`higgsfield generate create
 * nano_banana_2 …`) for each scene. Replaces the v2 Playwright path entirely.
 * Scene prompt design, variant rotation, idempotency-by-hero-pool, and DB
 * attach are unchanged from v2.
 *
 * Per invocation:
 *   1. Resolve product + visible variants + the hero pool (one entry per
 *      unique reference image — distinct storagePaths).
 *   2. Pick 6 reference variants by cycling through the hero pool.
 *   3. Ask Claude to design 6 unique Dazuma-aesthetic scene prompts, one per
 *      slot, each tied to the variant chosen for that slot.
 *   4. Download each picked variant's hero file to a temp dir.
 *   5. Fire 6 Higgsfield CLI generations in parallel (concurrency-capped) —
 *      each gets one scene prompt + that slot's variant hero as the single
 *      reference image (no positioning template — that's a hero-shot thing).
 *   6. Upload each output PNG to Supabase under `lifestyle/{productId}/<slug>.png`
 *      and create a `ProductImage` row with `imageType="lifestyle"`,
 *      `variantId: null`.
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl>
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --multi-unit 3
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --concurrency 3
 *
 * Auto-loads .env.local. See .claude/skills/lifestyle-image-creator/SKILL.md.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { runHiggsfieldCliBatch } from "./_higgsfield-cli";
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const COUNT = 6;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const OUT_DIR = path.join(os.tmpdir(), "scene", "output");
const REF_DIR = path.join(os.tmpdir(), "scene", "lifestyle-refs");

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  input: string;
  multiUnit: number | null;
  /** --multi-unit-mix: vary the unit count (2-4) across the 6 scenes. */
  multiUnitMix: boolean;
  dryRun: boolean;
  /** Parallel CLI invocations. Default 6 (all 6 scenes at once). Set to 1
   *  for fully sequential. */
  concurrency: number;
  only: number | null;
  /** Skip the standard 1-closeup-after-lifestyles step. Default is to
   *  ALWAYS generate one close-up after lifestyles complete (the standard
   *  rule). Use `--no-closeup` to opt out (e.g. retry-only flows). */
  noCloseup: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> [--multi-unit N] [--multi-unit-mix] [--dry-run] [--concurrency N] [--only=N]",
    );
    process.exit(1);
  }
  let input = "";
  let multiUnit: number | null = null;
  let multiUnitMix = false;
  let dryRun = false;
  let concurrency = 6;
  let only: number | null = null;
  let noCloseup = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--multi-unit-mix") {
      multiUnitMix = true;
    } else if (a === "--multi-unit") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) {
        multiUnit = parseInt(next, 10);
        i++;
      } else {
        multiUnit = 3;
      }
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--no-closeup") noCloseup = true;
    else if (a === "--concurrency") {
      const next = args[i + 1];
      const n = parseInt(next ?? "", 10);
      if (Number.isFinite(n) && n > 0) {
        concurrency = n;
        i++;
      }
    } else if (a.startsWith("--only=")) {
      const n = parseInt(a.slice("--only=".length), 10);
      if (Number.isFinite(n) && n > 0) only = n;
    } else if (!input) input = a;
  }
  if (!input) {
    console.error("Missing <input> argument.");
    process.exit(1);
  }
  return { input, multiUnit, multiUnitMix, dryRun, concurrency, only, noCloseup };
}

function detectProductId(input: string): string {
  const reviewMatch = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (reviewMatch) return reviewMatch[1];
  if (/^c[a-z0-9]{24,}$/.test(input)) return input;
  console.error(
    `Could not detect productId from "${input}". Expected a cuid or /review/<id> URL.`,
  );
  process.exit(1);
}

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function uploadToSupabase(
  buf: Buffer,
  storagePath: string,
): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  const supabase = getSupabase();
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 60)}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { input, multiUnit, multiUnitMix, dryRun, concurrency, only, noCloseup } = parseArgs();
  const productId = detectProductId(input);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REF_DIR, { recursive: true });

  // Fetch the product, retrying transient DB-connection failures. The Supabase
  // pgbouncer pooler intermittently refuses the first connection; without this
  // the whole run dies instantly at startup on a momentary blip.
  let product: Awaited<ReturnType<typeof fetchProduct>> = null;
  async function fetchProduct() {
    return getPrisma().product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
        images: true,
      },
    });
  }
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      product = await fetchProduct();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 6) {
        console.error(`DB fetch failed after 6 attempts: ${msg}`);
        process.exit(1);
      }
      console.warn(`  DB connection attempt ${attempt}/6 failed (transient) — retrying in 3s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!product) {
    console.error(`Product ${productId} not found`);
    process.exit(1);
  }
  // getPrisma() returns the cached client — the retry loop above already
  // created it. The rest of main() uses `prisma` directly.
  const prisma = getPrisma();

  console.log(`Lifestyle Image Creator (Higgsfield CLI) — ${product.title.slice(0, 60)}`);
  const dbMode = (product.lifestyleUnitMode ?? "auto") as LifestyleUnitMode;
  console.log(
    `Mode: ${multiUnitMix ? "multi-unit-mix CLI" : multiUnit ? `multi-unit CLI (${multiUnit})` : `inherited from DB lifestyleUnitMode=${dbMode}`}${
      dryRun ? " — DRY RUN (no Higgsfield calls)" : ""
    }`,
  );

  // ── Build the reference pool: one entry per unique reference file across
  //    visible variants. Each entry remembers the variant it came from so we
  //    can attribute the lifestyle to a variant in the prompt.
  //
  //    Reference resolution per variant (in order): the variant's featured
  //    image (ANY imageType — a clean hero, OR the scraped product photo),
  //    else a ProductImage tied to that variant, else any product image.
  //    Earlier this REQUIRED a hero/hero-flat image and hard-exited otherwise
  //    — which silently coupled lifestyles to a separate hero step that, when
  //    contaminated, poisoned every lifestyle. Using the variant's own image
  //    directly removes that whole failure mode.
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
      sourceUrl: img.storagePath
        ? publicSupabaseUrlFromPath(img.storagePath)
        : img.sourceUrl,
    });
    // Safeguard: log exactly which ProductImage feeds each reference, so a
    // wrong/contaminated reference is visible in the run log, not silent.
    console.log(
      `  ref ← variant pos ${v.position} | ProductImage ${img.id} | type=${img.imageType ?? "null"} | ${img.fileName ?? img.storagePath ?? img.sourceUrl}`,
    );
  }
  // Variantless fallback: if the product has zero variants (user clicked
  // "Remove all variants" or scrape returned 0), the loop above yielded
  // nothing. Use a generated product-level hero if one exists, else the
  // lowest-position scraped image. Same single reference cycles into all
  // 6 slots, matching the single-variant behavior.
  if (heroPool.length === 0 && product.variants.length === 0) {
    const variantlessHero = product.images.find(
      (img) =>
        (img.imageType === "hero" || img.imageType === "hero-flat") && !img.variantId,
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
        sourceUrl: img.storagePath
          ? publicSupabaseUrlFromPath(img.storagePath)
          : img.sourceUrl,
      });
      console.log(
        `  ref ← variantless product | ProductImage ${img.id} | type=${img.imageType ?? "null"} | ${img.fileName ?? img.storagePath ?? img.sourceUrl}`,
      );
    }
  }

  if (heroPool.length === 0) {
    console.error(
      "No reference image found — add a gallery image to the product first.",
    );
    process.exit(1);
  }

  // ── Slot assignment. When the hero pool already contains ≥6 unique references,
  //    use the first 6 directly (one variant per slot — no repeats) so the
  //    gallery showcases the full range. Otherwise cycle the pool as before.
  const useUniquePerSlot = heroPool.length >= COUNT;
  console.log(
    `Unique reference pool: ${heroPool.length} variant reference(s) — ` +
      (useUniquePerSlot
        ? `using first ${COUNT} as one-per-slot (no cycling).`
        : `cycling to ${COUNT} slots.`),
  );
  const slots = Array.from({ length: COUNT }).map((_, i) => {
    const ref = useUniquePerSlot ? heroPool[i] : heroPool[i % heroPool.length];
    return {
      slotIndex: i,
      variantPosition: ref.variantPosition,
      variantTitle: ref.variantTitle,
      heroUrl: ref.sourceUrl,
    };
  });

  // ── Per-slot unit counts. CLI overrides (--multi-unit / --multi-unit-mix)
  //    win first; otherwise the product's stored `lifestyleUnitMode` ("auto"
  //    by default, or "single" / "multi" if the user has set it on the review
  //    page) feeds the unit-mix policy.
  const category = classifyCategory(`${product.title} ${typeLeaf(product.productType)}`);
  const userOverridesUnitCount = multiUnit !== null || multiUnitMix;
  const productMode = (product.lifestyleUnitMode ?? "auto") as LifestyleUnitMode;
  // Honor Product.lifestyleUnitMode when no CLI override is set:
  //   "multi"  → undefined per slot so the scene designer picks varied 2-4 units
  //   "single" → 1 per slot
  //   "auto"   → 1 per slot (preserves the no-multi-unit-by-default rule)
  const unitCounts: (number | undefined)[] = userOverridesUnitCount
    ? Array(COUNT).fill(undefined)
    : productMode === "multi"
      ? Array(COUNT).fill(undefined)
      : Array(COUNT).fill(1);
  // Effective multi-unit-mix: CLI wins, otherwise the DB flag drives it.
  const effectiveMultiUnitMix = userOverridesUnitCount
    ? multiUnitMix
    : productMode === "multi";
  if (!userOverridesUnitCount) {
    console.log(
      `  Category=${category}  mode=${productMode}  per-slot unit counts: [${unitCounts.map((c) => c ?? "auto").join(", ")}]`,
    );
  }
  const refsForDesigner = slots.map((s, i) => ({
    slotIndex: s.slotIndex,
    variantPosition: s.variantPosition,
    variantTitle: s.variantTitle,
    unitCount: unitCounts[i],
  }));

  // ── Ask Claude to design 6 unique scene prompts.
  console.log(`Asking Claude to design ${COUNT} unique Dazuma-aesthetic scenes...`);
  const designed = await designLifestyleScenes({
    productId,
    productTitle: product.title,
    productType: product.productType ?? null,
    unitCount: multiUnit ?? (effectiveMultiUnitMix ? 3 : 1),
    unitCountVaried: effectiveMultiUnitMix,
    references: refsForDesigner,
    hasSizeReference: false,
  });
  const scenes = designed.scenes;
  console.log(`  Classified as: ${designed.category}`);
  console.log(`  Got ${scenes.length} scene(s).`);
  scenes.forEach((s, i) => {
    console.log(`    [${i + 1}] ${s.slug} → variantPosition=${s.variantPosition}`);
  });

  if (dryRun) {
    console.log("\n─── Dry run: scene prompts (first 400 chars each) ───");
    scenes.forEach((s, i) => {
      console.log(`\n[${i + 1}] ${s.slug}\n${s.prompt}`);
    });
    await prisma.$disconnect();
    return;
  }

  // ── Map variantPosition → slot's heroUrl so each scene gets the right ref.
  const heroByPos = new Map<number, string>();
  for (const slot of slots) heroByPos.set(slot.variantPosition, slot.heroUrl);

  // ── Download each scene's reference variant hero to a local file. Higgsfield
  //    uploads files (not URLs).
  const t0 = Date.now();
  const promptItems: Array<{
    slug: string;
    text: string;
    referenceImages: string[];
    referenceUrl: string;
    variantPosition: number;
  }> = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const heroUrl =
      heroByPos.get(scene.variantPosition) ?? heroPool[i % heroPool.length].sourceUrl;
    const slug = `v1_lifestyle_${i + 1}_${safeSlug(scene.slug)}`;
    // productId prefix prevents cross-product collisions in the shared temp
    // dir when multiple lifestyle runs fan out in parallel.
    const refPath = path.join(REF_DIR, `${productId}__${slug}.jpg`);
    console.log(`  [${i + 1}/${scenes.length}] Downloading reference for slot ${slug} ← ${heroUrl}`);
    await downloadToFile(heroUrl, refPath);
    const refs = [refPath];
    promptItems.push({
      slug,
      text: scene.prompt,
      referenceImages: refs,
      referenceUrl: heroUrl,
      variantPosition: scene.variantPosition,
    });
  }

  // ── Optionally limit to first N prompts (for smoke tests).
  const limitedPrompts = only != null ? promptItems.slice(0, only) : promptItems;
  if (only != null) {
    console.log(`(--only=${only}) limiting to first ${limitedPrompts.length} of ${promptItems.length}`);
  }

  // ── Drive Higgsfield CLI. Each prompt sends ONE reference image (the
  //    variant hero). No positioning template — that's a hero-shot thing.
  //    Concurrency=6 fires all scenes simultaneously; drop it lower to throttle.
  console.log(
    `\nFiring ${limitedPrompts.length} Higgsfield CLI jobs (concurrency=${concurrency})...`,
  );
  const { ok, fail } = await runHiggsfieldCliBatch({
    prompts: limitedPrompts.map((p) => ({
      slug: p.slug,
      text: p.text,
      referenceImage: p.referenceImages,
    })),
    outDir: OUT_DIR,
    concurrency,
  });
  const wallTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nGeneration done. ${ok}/${promptItems.length} succeeded, ${fail} failed. Wall time: ${wallTime}s.`,
  );

  // ── Per-scene retry (closes most "5/6 attached" cases). Find which slugs
  //    didn't land an output PNG and refire just those, once, after a short
  //    backoff to clear transient Higgsfield content-mod hiccups. Persistent
  //    failures (model truly refuses a frame) still drop and we attach what
  //    we have — but a single transient is no longer a sticky 5/6.
  const failedAfterFirst = limitedPrompts.filter(
    (p) => !fs.existsSync(path.join(OUT_DIR, `${p.slug}.png`)),
  );
  if (failedAfterFirst.length > 0) {
    console.log(
      `\nRetrying ${failedAfterFirst.length} failed scene(s) once after 4s...`,
    );
    await new Promise((r) => setTimeout(r, 4000));
    const retryT0 = Date.now();
    const retryResult = await runHiggsfieldCliBatch({
      prompts: failedAfterFirst.map((p) => ({
        slug: p.slug,
        text: p.text,
        referenceImage: p.referenceImages,
      })),
      outDir: OUT_DIR,
      concurrency,
    });
    const retryWall = ((Date.now() - retryT0) / 1000).toFixed(1);
    console.log(
      `Retry done. ${retryResult.ok}/${failedAfterFirst.length} recovered, ${retryResult.fail} still failed. Retry wall time: ${retryWall}s.`,
    );
  }

  // ── Upload + DB attach each successful output. Skip any slot whose file
  //    didn't land (Higgsfield failure).
  console.log(`\nAttaching lifestyles to product gallery...`);
  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;

  let attached = 0;
  for (const p of limitedPrompts) {
    const localPath = path.join(OUT_DIR, `${p.slug}.png`);
    if (!fs.existsSync(localPath)) {
      console.warn(`  ${p.slug}: no output file — skipping DB attach`);
      continue;
    }
    const buf = fs.readFileSync(localPath);
    const storagePath = `lifestyle/${productId}/${p.slug}.png`;
    try {
      const publicUrl = await uploadToSupabase(buf, storagePath);
      await prisma.productImage.create({
        data: {
          productId,
          variantId: null,
          sourceUrl: publicUrl,
          storagePath,
          fileName: `${p.slug}.png`,
          altText: `Lifestyle scene — ${product.title.slice(0, 80)}`,
          position: nextPosition++,
          downloadStatus: "downloaded",
          imageType: "lifestyle",
        },
      });
      attached++;
      console.log(`  ${p.slug} → uploaded + attached`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${p.slug} → DB attach FAIL: ${msg}`);
    }
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log(
    `Attached ${attached}/${limitedPrompts.length} lifestyles. Total wall time: ${totalElapsed}s.`,
  );
  console.log(`Review URL: http://localhost:3000/review/${productId}`);

  // Standard rule: every lifestyle run also produces 1 close-up. We spawn
  // _hf-cli-bulk-closeups.ts (--count 1) here so the existing close-up
  // pipeline owns its own retry / idempotency logic — keeping this script
  // single-responsibility. `--no-closeup` opts out for retry-only flows.
  if (!noCloseup && attached > 0) {
    console.log(`\n--- closeup step (standard 1-closeup-per-lifestyle-run rule) ---`);
    const cuStart = Date.now();
    const cuCode = await new Promise<number>((resolve) => {
      const proc = spawn(
        "npx",
        [
          "tsx",
          "scripts/_hf-cli-bulk-closeups.ts",
          "--products",
          productId,
          "--count",
          "1",
        ],
        { stdio: "inherit", shell: true },
      );
      proc.on("close", (code) => resolve(code ?? -1));
      proc.on("error", (err) => {
        console.error(`closeup spawn err: ${err.message}`);
        resolve(-1);
      });
    });
    const cuSec = ((Date.now() - cuStart) / 1000).toFixed(1);
    console.log(`closeup step done in ${cuSec}s (exit ${cuCode})`);
  } else if (noCloseup) {
    console.log(`Skipping closeup step (--no-closeup).`);
  } else {
    console.log(`Skipping closeup step (no lifestyles attached).`);
  }

  console.log(`\n========== RUN_COMPLETE ==========`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  if (_prisma) await _prisma.$disconnect();
  process.exit(1);
});
