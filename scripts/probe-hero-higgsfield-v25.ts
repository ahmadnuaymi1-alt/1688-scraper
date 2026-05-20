/**
 * v25 — Higgsfield hero-image generator. One hero shot per variant of a local-DB
 * product, using the v24 Higgsfield Playwright wrapper.
 *
 * Reads variants + featured images from the local Prisma DB. Downloads each
 * source reference to a temp folder. Sends one hero-prompt job per variant
 * through the Higgsfield UI. Outputs land in /tmp/scene/output/v25_hero_<slug>.png.
 *
 * Usage:
 *   npx tsx scripts/probe-hero-higgsfield-v25.ts <productId-or-reviewURL> [--headed] [--keep-open]
 *
 * Example:
 *   npx tsx scripts/probe-hero-higgsfield-v25.ts http://localhost:3002/review/cmp89vzm600nhw26gnsg8jqyj
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { runHiggsfieldBatch } from "./_higgsfield-lifestyle";
import { HERO_PROMPT } from "../src/lib/hero/prompt";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

async function uploadToSupabase(buf: Buffer, storagePath: string): Promise<string> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env.local");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

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

const OUT_DIR = path.join(os.tmpdir(), "scene", "output");
const REF_DIR = path.join(os.tmpdir(), "scene", "v25-refs");
const POSITIONING_TEMPLATE = path.join(REF_DIR, "positioning-template.png");

// HERO_PROMPT lives in src/lib/hero/prompt.ts so the API retry endpoint can
// reuse the exact same text. Imported at the top of this file.

function detectProductId(input: string): string {
  const m = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^c[a-z0-9]{20,}$/.test(input)) return input;
  console.error(`Could not detect productId from "${input}"`);
  process.exit(1);
}

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url.slice(0, 60)}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--"));
  const forceHeaded = args.includes("--headed");
  const keepOpen = args.includes("--keep-open");
  const parallel = args.includes("--parallel");
  const queued = args.includes("--queued");
  if (!input) {
    console.error("Usage: npx tsx scripts/probe-hero-higgsfield-v25.ts <productIdOrReviewURL> [--headed] [--keep-open] [--parallel] [--queued]");
    process.exit(1);
  }
  const productId = detectProductId(input);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(REF_DIR, { recursive: true });

  const prisma = new PrismaClient();
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
        images: true,
      },
    });
    if (!product) {
      console.error(`Product ${productId} not found in local DB.`);
      process.exit(1);
    }
    console.log(`Product: ${product.title.slice(0, 80)}`);
    console.log(`Visible variants: ${product.variants.length}`);

    // Build a map of variantId -> source image. Prefer the variant's CURRENT
    // featuredImage (what the user sees on the variant card in the review UI).
    // Fall back to any image with this variantId set if there's no featured.
    // We exclude hero / hero-flat rows so we never use a previously generated
    // hero as the source — only the original supplier photo.
    const sourceImages = product.images.filter((img) => img.imageType !== "hero" && img.imageType !== "hero-flat");
    const imagesById = new Map(sourceImages.map((img) => [img.id, img]));
    const imagesByVariant = new Map<string, (typeof sourceImages)[number]>();
    // First pass: use variant.featuredImageId — that's what the user perceives
    // as "the variant's image."
    for (const v of product.variants) {
      if (!v.featuredImageId) continue;
      const img = imagesById.get(v.featuredImageId);
      if (img) imagesByVariant.set(v.id, img);
    }
    // Second pass: for variants with no featured image, fall back to any image
    // with their variantId set.
    for (const img of sourceImages) {
      if (!img.variantId) continue;
      if (imagesByVariant.has(img.variantId)) continue;
      imagesByVariant.set(img.variantId, img);
    }

    // Group variants by their source image so we only generate ONCE per unique source.
    const groups = new Map<string, { sourceUrl: string; variantTitles: string[]; variantIds: string[] }>();
    for (const v of product.variants) {
      const src = imagesByVariant.get(v.id);
      if (!src) {
        console.warn(`  Variant "${v.title}" has no source image — skipping.`);
        continue;
      }
      // Prefer storagePath (Supabase) over sourceUrl (raw supplier).
      let sourceUrl = src.sourceUrl;
      if (src.storagePath) {
        const supabaseBase = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
        const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
        if (supabaseBase) sourceUrl = `${supabaseBase}/storage/v1/object/public/${bucket}/${src.storagePath}`;
      }
      const key = sourceUrl;
      const existing = groups.get(key);
      if (existing) {
        existing.variantTitles.push(v.title);
        existing.variantIds.push(v.id);
      } else {
        groups.set(key, { sourceUrl, variantTitles: [v.title], variantIds: [v.id] });
      }
    }
    console.log(`Unique source images: ${groups.size} (will generate ${groups.size} heroes)`);

    const prompts: Array<{ slug: string; text: string; referenceImage: string; variantIds: string[] }> = [];
    let idx = 0;
    for (const [key, g] of groups) {
      idx++;
      // Include the canonical variantId suffix so the slug is unique per
      // variant even when the title strips to empty (e.g. Chinese-only
      // titles like "棕色" → ""). Without this, two regeneration runs of
      // different variants land on the same file path and the second one
      // upserts over the first.
      const slug = `v25_hero_${idx}_${g.variantIds[0].slice(-6)}_${safeSlug(g.variantTitles[0])}`;
      const refPath = path.join(REF_DIR, `${slug}.jpg`);
      console.log(`  [${idx}/${groups.size}] Downloading reference for "${g.variantTitles.join(" / ")}"`);
      await downloadToFile(g.sourceUrl, refPath);
      prompts.push({
        slug,
        text: HERO_PROMPT,
        referenceImage: refPath,
        variantIds: g.variantIds,
      });
    }

    if (prompts.length === 0) {
      console.error("No variants with source images — nothing to generate.");
      process.exit(1);
    }

    // Debug mode: pass --only=1 to limit to just the first prompt for testing.
    const onlyArg = args.find((a) => a.startsWith("--only="));
    if (onlyArg) {
      const n = parseInt(onlyArg.split("=")[1], 10);
      if (!isNaN(n) && n > 0) {
        prompts.splice(n);
        console.log(`(--only=${n}) limiting to first ${prompts.length} variant(s) for this run.`);
      }
    }

    console.log(`\nFiring ${prompts.length} Higgsfield jobs (one per unique variant image)...`);
    const t0 = Date.now();
    if (!fs.existsSync(POSITIONING_TEMPLATE)) {
      console.error(`Positioning template not found at ${POSITIONING_TEMPLATE}.`);
      console.error(`Generate it first: see the sharp-based script in v25 docs.`);
      process.exit(1);
    }
    console.log(`Using positioning template: ${POSITIONING_TEMPLATE}`);

    const { ok, fail } = await runHiggsfieldBatch({
      referenceImage: prompts[0].referenceImage,
      // Each prompt uploads TWO references: the variant's product photo AND the
      // positioning template. The template tells the model where to place the
      // product inside the frame.
      prompts: prompts.map((p) => ({
        slug: p.slug,
        text: p.text,
        // Two references per shot: (1) the variant product image, (2) the
        // positioning template (white frame with black inset rect). The
        // wrapper handles sequential upload via the "add another" icon button.
        referenceImage: [p.referenceImage, POSITIONING_TEMPLATE],
      })),
      outDir: OUT_DIR,
      forceHeaded,
      keepOpen,
      parallel,
      queued,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nGeneration done. ${ok}/${prompts.length} succeeded, ${fail} failed. Wall time: ${elapsed}s.`);
    console.log(`Folder: ${OUT_DIR}`);

    // ─── Attach generated heroes to the DB so they show up in the review UI ───
    console.log(`\nAttaching heroes to product variants in DB...`);
    const maxPosRow = await prisma.productImage.aggregate({
      where: { productId },
      _max: { position: true },
    });
    let nextPosition = (maxPosRow._max.position ?? 0) + 1;

    let attachedCount = 0;
    for (const p of prompts) {
      const localPath = path.join(OUT_DIR, `${p.slug}.png`);
      if (!fs.existsSync(localPath)) {
        console.warn(`  ${p.slug}: no output file — skipping DB attach`);
        continue;
      }
      const buf = fs.readFileSync(localPath);
      const storagePath = `heroes/${productId}/${p.slug}.png`;
      try {
        const publicUrl = await uploadToSupabase(buf, storagePath);
        // Attach this hero to every variant in the group that shares this source.
        for (let i = 0; i < p.variantIds.length; i++) {
          const variantId = p.variantIds[i];
          // imageType "hero-flat" so the image shows in the product gallery
          // (the gallery hides raw "hero" rows as intermediate artifacts).
          // Higgsfield's studio prompt already outputs a clean white background,
          // so the Higgsfield render IS the finished "flat" version — no
          // separate post-processing step needed.
          const created = await prisma.productImage.create({
            data: {
              productId,
              variantId,
              sourceUrl: publicUrl,
              storagePath,
              fileName: `${p.slug}.png`,
              position: nextPosition++,
              downloadStatus: "downloaded",
              imageType: "hero-flat",
            },
          });
          await prisma.variant.update({
            where: { id: variantId },
            data: { featuredImageId: created.id },
          });
          attachedCount++;
        }
        console.log(`  ${p.slug} → uploaded + attached to ${p.variantIds.length} variant(s)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ${p.slug} → DB attach FAIL: ${msg}`);
      }
    }
    const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone. Attached heroes to ${attachedCount} variant(s).`);
    console.log(`Review URL: http://localhost:3002/review/${productId}`);
    console.log(`\n========== RUN_COMPLETE ==========`);
    console.log(`Total wall time (generation + DB attach): ${totalElapsed}s`);
    console.log(`==================================`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
