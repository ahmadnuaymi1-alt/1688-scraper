/**
 * Lifestyle Image Creator — Mode A (local DB) only.
 *
 * v2: drives Higgsfield's web UI via Playwright (mirrors the hero-image-creator
 * flow). Replaces the v1 kie.ai / Nano Banana Pro API path entirely.
 *
 * Per invocation:
 *   1. Resolve product + visible variants + the hero pool (one hero per unique
 *      reference variant — distinct storagePaths).
 *   2. Gate: bail if zero heroes — "Run /hero-image-creator first".
 *   3. Pick 6 reference variants by cycling through the hero pool.
 *   4. Ask Claude to design 6 unique Dazuma-aesthetic scene prompts, one per
 *      slot, each tied to the variant chosen for that slot.
 *   5. Download each picked variant's hero file to a temp dir.
 *   6. Drive Higgsfield in PARALLEL — each tab gets one scene prompt + that
 *      slot's variant hero as the single reference image.
 *   7. Upload each output PNG to Supabase under `lifestyle/{productId}/<slug>.png`
 *      and create a `ProductImage` row with `imageType="lifestyle"`,
 *      `variantId: null`, `sourceReferenceUrl` pointing back at the variant
 *      hero used as the reference (for audit).
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl>
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --multi-unit 3
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --headed --keep-open
 *
 * Auto-loads .env.local. See .claude/skills/lifestyle-image-creator/SKILL.md.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { runHiggsfieldBatch } from "./_higgsfield-lifestyle";
import { designLifestyleScenes } from "../src/services/lifestyle-scene-designer.service";

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
  dryRun: boolean;
  headed: boolean;
  keepOpen: boolean;
  sequential: boolean;
  queued: boolean;
  only: number | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> [--multi-unit N] [--dry-run] [--headed] [--keep-open] [--sequential] [--queued] [--only=N]",
    );
    process.exit(1);
  }
  let input = "";
  let multiUnit: number | null = null;
  let dryRun = false;
  let headed = false;
  let keepOpen = false;
  let sequential = false;
  let queued = false;
  let only: number | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--multi-unit") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) {
        multiUnit = parseInt(next, 10);
        i++;
      } else {
        multiUnit = 3;
      }
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--headed") headed = true;
    else if (a === "--keep-open") keepOpen = true;
    else if (a === "--sequential") sequential = true;
    else if (a === "--queued") queued = true;
    else if (a.startsWith("--only=")) {
      const n = parseInt(a.slice("--only=".length), 10);
      if (Number.isFinite(n) && n > 0) only = n;
    } else if (!input) input = a;
  }
  if (!input) {
    console.error("Missing <input> argument.");
    process.exit(1);
  }
  return { input, multiUnit, dryRun, headed, keepOpen, sequential, queued, only };
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
  const { input, multiUnit, dryRun, headed, keepOpen, sequential, queued, only } =
    parseArgs();
  const productId = detectProductId(input);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REF_DIR, { recursive: true });

  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: true,
    },
  });
  if (!product) {
    console.error(`Product ${productId} not found`);
    process.exit(1);
  }

  console.log(`Lifestyle Image Creator (Higgsfield) — ${product.title.slice(0, 60)}`);
  console.log(
    `Mode: ${multiUnit ? `multi-unit (${multiUnit} per image)` : "single-unit"}${
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
  if (heroPool.length === 0) {
    console.error(
      "No reference image found for any visible variant on this product.",
    );
    process.exit(1);
  }
  console.log(
    `Unique reference pool: ${heroPool.length} variant reference(s) — will cycle to ${COUNT} slots.`,
  );

  // ── Pick the 6 references (cycling through the pool).
  // Size-anchor / second-reference behavior was removed — only the variant hero
  // is attached per scene. A prior lifestyle as size-anchor confused the image
  // model when variants had different form factors (e.g. a tall floor-lamp
  // variant rendering at table-lamp scale because the anchor was a table-lamp).
  const slots = Array.from({ length: COUNT }).map((_, i) => {
    const ref = heroPool[i % heroPool.length];
    return {
      slotIndex: i,
      variantPosition: ref.variantPosition,
      variantTitle: ref.variantTitle,
      heroUrl: ref.sourceUrl,
    };
  });

  // ── Ask Claude to design 6 unique scene prompts.
  console.log(`Asking Claude to design ${COUNT} unique Dazuma-aesthetic scenes...`);
  const designed = await designLifestyleScenes({
    productTitle: product.title,
    productType: product.productType ?? null,
    unitCount: multiUnit ?? 1,
    references: slots,
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
      console.log(`\n[${i + 1}] ${s.slug}\n${s.prompt.slice(0, 400)}…`);
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
    const refPath = path.join(REF_DIR, `${slug}.jpg`);
    console.log(`  [${i + 1}/${COUNT}] Downloading reference for slot ${slug} ← ${heroUrl}`);
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

  // ── Drive Higgsfield. Each prompt sends ONE reference image (the variant
  //    hero). No positioning template — that's a hero-shot thing. Sequential
  //    mode (one tab at a time) is the workaround for Higgsfield's anti-bot
  //    "Verification Required" wall that triggers on 6 parallel Generate
  //    bursts; parallel is faster when the account isn't flagged.
  console.log(
    `\nFiring ${limitedPrompts.length} Higgsfield jobs ${sequential ? "sequentially" : "in parallel"}...`,
  );
  const { ok, fail } = await runHiggsfieldBatch({
    referenceImage: limitedPrompts[0].referenceImages[0],
    prompts: limitedPrompts.map((p) => ({
      slug: p.slug,
      text: p.text,
      referenceImage: p.referenceImages,
    })),
    outDir: OUT_DIR,
    forceHeaded: headed,
    keepOpen,
    parallel: !sequential,
    queued,
  });
  const wallTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nGeneration done. ${ok}/${promptItems.length} succeeded, ${fail} failed. Wall time: ${wallTime}s.`,
  );

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
  console.log(`\n========== RUN_COMPLETE ==========`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  if (_prisma) await _prisma.$disconnect();
  process.exit(1);
});
