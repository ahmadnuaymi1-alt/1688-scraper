/**
 * Bulk hero generation for the latest N scraped products via the OFFICIAL
 * Higgsfield CLI (`higgsfield generate create nano_banana_2 …`).
 *
 * Why a new script: the existing `_hero-image-creator.ts` is invoked one
 * product at a time and routes through Kie's seedream model. This script
 * batches the LATEST 11 scraped products into a single invocation, fans out
 * all unique-hero generations through Higgsfield's API up to the Ultra plan's
 * 8-in-flight ceiling, and persists results in the EXACT same DB shape as the
 * legacy script (so the review page, gallery preset, and Shopify uploader
 * continue to work without changes).
 *
 * The legacy `_hero-image-creator.ts` is intentionally untouched — revert is
 * "stop running this script."
 *
 * Usage:
 *   npx tsx scripts/_hf-cli-bulk-heroes.ts              # full run, latest 11 products
 *   npx tsx scripts/_hf-cli-bulk-heroes.ts --dry-run    # list planned generations, no spend
 *   npx tsx scripts/_hf-cli-bulk-heroes.ts --take 5     # latest 5 instead of 11
 *   npx tsx scripts/_hf-cli-bulk-heroes.ts --concurrency 6   # dial in-flight below plan cap
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { HERO_PROMPT } from "../src/lib/hero/prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Perceptual dedup — dHash (difference hash)
//
// Suppliers on 1688 often re-save the SAME product photograph with a
// different text label baked in (orange title chip, bottom-right cell, etc.)
// for each option-axis combination. The exact storagePath dedup the pool
// builder uses can't see through the text-overlay difference and treats them
// as N distinct supplier photos, then generates N heroes. This module
// fingerprints each unique source image with a 64-bit dHash (resize to 9x8
// grayscale, compare adjacent pixels) and merges images whose Hamming
// distance is below `DHASH_MERGE_THRESHOLD`. Images that differ only in a
// small text chip differ by 2-6 bits; images of genuinely different products
// differ by 25+ bits — so the threshold is generous (8 bits) without risk of
// merging real distinct products.
// ─────────────────────────────────────────────────────────────────────────────
const DHASH_MERGE_THRESHOLD = 8;

async function computeDhash(buf: Buffer): Promise<string> {
  const { data } = await sharp(buf)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return bits;
}

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

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
const POSITIONING_TEMPLATE = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
const REF_CACHE_DIR = path.join(os.tmpdir(), "hf-cli-bulk", "refs");
const OUT_CACHE_DIR = path.join(os.tmpdir(), "hf-cli-bulk", "out");

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  take: number;
  concurrency: number;
  dryRun: boolean;
  /** When set, overrides "latest N from ScrapeJob" — uses these IDs verbatim. */
  productIds: string[] | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let take = 11;
  let concurrency = 8;
  let dryRun = false;
  let productIds: string[] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--take") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) take = n;
    } else if (a === "--concurrency") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
    } else if (a === "--products") {
      const raw = argv[++i] ?? "";
      productIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return { take, concurrency, dryRun, productIds };
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
  const { error } = await getSupabase().storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  return publicSupabaseUrlFromPath(storagePath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Higgsfield CLI spawn — Windows-safe quoting (see _test-higgsfield-cli-hero.ts)
// ─────────────────────────────────────────────────────────────────────────────
function runHiggsfield(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const quoted = args.map((a) => `"${a.replace(/"/g, '""')}"`).join(" ");
    const cmd = `higgsfield ${quoted}`;
    const proc = spawn(cmd, [], { shell: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? -1, out }));
    proc.on("error", (err) => resolve({ code: -1, out: err.message }));
  });
}

function extractJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`no JSON in CLI output: ${raw.slice(-200)}`);
  return JSON.parse(match[0]) as T;
}

async function higgsfieldUpload(file: string): Promise<string> {
  const r = await runHiggsfield(["upload", "create", file, "--json"]);
  if (r.code !== 0) throw new Error(`upload failed for ${file}: exit ${r.code}: ${r.out.slice(-200)}`);
  const parsed = extractJson<{ id?: string }>(r.out);
  if (!parsed.id) throw new Error(`upload returned no id for ${file}: ${r.out.slice(-200)}`);
  return parsed.id;
}

interface KieResultUrls { resultUrls?: string[] }
interface GenerateJobJson {
  id?: string;
  status?: string;
  results?: Array<{ url?: string }>;
  // The CLI's --json output for `generate create --wait` includes a job
  // record. The actual field for the produced image URL varies by model;
  // we probe a few common shapes.
  outputs?: Array<{ url?: string }>;
  result?: { url?: string; urls?: string[] };
  raw?: unknown;
}

function extractResultUrl(out: string): string | null {
  // Pull every https URL that looks like a CloudFront image (png/jpg/jpeg/webp
  // — the CLI sometimes returns jpeg, not just png). Pick the first non-upload
  // (d8j0… is the render bucket; d2ol… is the user-upload bucket).
  const urls = out.match(/https?:\/\/[^\s"',)]+\.(?:png|jpe?g|webp)/gi) || [];
  if (urls.length === 0) return null;
  const result = urls.find((u) => !u.includes("d2ol"));
  return result ?? urls[urls.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny concurrency limiter (no extra dep)
// ─────────────────────────────────────────────────────────────────────────────
function makeLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((res) => queue.push(res));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero pool (mirrors _hero-image-creator.ts:355-405)
// ─────────────────────────────────────────────────────────────────────────────
interface HeroGroup {
  productId: string;
  productTitle: string;
  sourceKey: string;       // dedup key — storagePath || sourceUrl
  sourceUrl: string;       // the URL we download for the variant ref
  groupKey: string;        // sanitized for Supabase path
  variants: Array<{ id: string; position: number; title: string }>;
  positionBase: number;    // first ProductImage.position to use
}

async function buildHeroGroupsForProduct(productId: string): Promise<{
  groups: HeroGroup[];
  skipExisting: number;
  skipNoSource: number;
  title: string;
}> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) throw new Error(`product ${productId} not found`);

  // sourceImages = raw scraped images. Exclude BOTH "hero" (legacy raw
  // Seedream/Kie output) AND "hero-flat" (what THIS script writes) so a
  // second run doesn't re-generate heroes using the previous hero as the
  // "source" image.
  const sourceImages = product.images.filter(
    (img) => img.imageType !== "hero" && img.imageType !== "hero-flat",
  );
  const imagesByVariant = new Map<string, (typeof sourceImages)[number]>();
  const imagesById = new Map<string, (typeof sourceImages)[number]>();
  for (const img of sourceImages) {
    imagesById.set(img.id, img);
    if (!img.variantId) continue;
    if (!imagesByVariant.has(img.variantId)) imagesByVariant.set(img.variantId, img);
  }
  // featuredImageId backfill
  for (const v of product.variants) {
    if (imagesByVariant.has(v.id)) continue;
    if (!v.featuredImageId) continue;
    const img = imagesById.get(v.featuredImageId);
    if (img) imagesByVariant.set(v.id, img);
  }

  // Idempotency: variants that already have a hero. Count BOTH "hero" (from
  // the legacy Kie pipeline) AND "hero-flat" (what this script writes).
  const variantsWithHero = new Set(
    product.images
      .filter(
        (img) =>
          (img.imageType === "hero" || img.imageType === "hero-flat") && img.variantId,
      )
      .map((img) => img.variantId as string),
  );

  // Group visible variants by unique source image (exact storagePath dedup).
  const groupMap = new Map<string, HeroGroup>();
  let skipNoSource = 0;
  for (const v of product.variants) {
    const src = imagesByVariant.get(v.id);
    if (!src) {
      skipNoSource++;
      continue;
    }
    const sourceKey = src.storagePath || src.sourceUrl;
    const sourceUrl = src.storagePath ? publicSupabaseUrlFromPath(src.storagePath) : src.sourceUrl;
    const existing = groupMap.get(sourceKey);
    if (existing) {
      existing.variants.push({ id: v.id, position: v.position, title: v.title });
    } else {
      const groupKey = sourceKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
      groupMap.set(sourceKey, {
        productId,
        productTitle: product.title,
        sourceKey,
        sourceUrl,
        groupKey,
        variants: [{ id: v.id, position: v.position, title: v.title }],
        positionBase: 0, // filled in below
      });
    }
  }

  // Perceptual dedup pass — merge groups whose source images are visually
  // identical (Hamming distance < DHASH_MERGE_THRESHOLD). This catches the
  // 1688-supplier pattern of re-saving the same product photo with a
  // different baked-in text label for each option-axis combination.
  const groupsList = Array.from(groupMap.values());
  if (groupsList.length > 1) {
    const hashes = await Promise.all(
      groupsList.map(async (g) => {
        try {
          const r = await fetch(g.sourceUrl);
          if (!r.ok) return null;
          const buf = Buffer.from(await r.arrayBuffer());
          return await computeDhash(buf);
        } catch {
          return null;
        }
      }),
    );
    // Union-find style merge: walk groups in order, merge each into the
    // first earlier group whose hash is within the threshold.
    const mergedInto = new Array<number>(groupsList.length).fill(-1);
    for (let i = 1; i < groupsList.length; i++) {
      const hi = hashes[i];
      if (!hi) continue;
      for (let j = 0; j < i; j++) {
        if (mergedInto[j] !== -1) continue;
        const hj = hashes[j];
        if (!hj) continue;
        if (hammingDistance(hi, hj) < DHASH_MERGE_THRESHOLD) {
          mergedInto[i] = j;
          // Move variants from i into j; keep j's sourceKey/sourceUrl/groupKey.
          groupsList[j].variants.push(...groupsList[i].variants);
          break;
        }
      }
    }
    // Rebuild groupMap from the not-merged-away groups.
    groupMap.clear();
    let mergedCount = 0;
    for (let i = 0; i < groupsList.length; i++) {
      if (mergedInto[i] !== -1) {
        mergedCount++;
        continue;
      }
      const g = groupsList[i];
      groupMap.set(g.sourceKey, g);
    }
    if (mergedCount > 0) {
      console.log(
        `  [${productId}] dHash dedup merged ${mergedCount} duplicate source-image group(s) — ${groupMap.size} unique product appearance(s) remain`,
      );
    }
  }

  // Apply idempotency + assign position bases (reserve N positions per group).
  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;

  const kept: HeroGroup[] = [];
  let skipExisting = 0;
  for (const g of groupMap.values()) {
    const hasHero = g.variants.some((v) => variantsWithHero.has(v.id));
    if (hasHero) {
      skipExisting++;
      continue;
    }
    // One ProductImage row per group now (not one per variant), so reserve
    // a single position per group.
    g.positionBase = nextPosition;
    nextPosition += 1;
    kept.push(g);
  }

  return { groups: kept, skipExisting, skipNoSource, title: product.title };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation step: download ref → upload to HF → generate → persist
// ─────────────────────────────────────────────────────────────────────────────
async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function runOneGroup(
  group: HeroGroup,
  templateUploadId: string,
  promptOneLine: string,
): Promise<{ ok: boolean; genSec: number; attached: number; error?: string }> {
  const tStart = Date.now();
  try {
    // 1. Download variant ref locally (filename derived from groupKey).
    const refLocal = path.join(REF_CACHE_DIR, `${group.productId}__${group.groupKey}.png`);
    if (!fs.existsSync(refLocal)) await downloadTo(group.sourceUrl, refLocal);
    // 2. Upload ref to Higgsfield.
    const refUploadId = await higgsfieldUpload(refLocal);
    // 3. Fire generation.
    const inputImagesJson = JSON.stringify([
      { id: refUploadId, type: "media_input" },
      { id: templateUploadId, type: "media_input" },
    ]);
    const args = [
      "generate", "create", "nano_banana_2",
      "--prompt", promptOneLine,
      "--input_images", inputImagesJson,
      "--aspect_ratio", "1:1",
      "--resolution", "2k",
      "--wait",
    ];
    const r = await runHiggsfield(args);
    if (r.code !== 0) throw new Error(`generate exit ${r.code}: ${r.out.slice(-300)}`);
    const resultUrl = extractResultUrl(r.out);
    if (!resultUrl) throw new Error(`no result URL in CLI output: ${r.out.slice(-300)}`);

    // 4. Download output PNG.
    const outRes = await fetch(resultUrl);
    if (!outRes.ok) throw new Error(`download result ${outRes.status} ${resultUrl}`);
    const outBuf = Buffer.from(await outRes.arrayBuffer());

    // 5. Upload to Supabase at the convention path.
    const storagePath = `heroes/${group.productId}/${group.groupKey}.png`;
    const publicUrl = await uploadToSupabase(outBuf, storagePath);

    // 6. Create ONE ProductImage row per dedup group and point all sister
    //    variants' featuredImageId at it. Previously we created N rows (one
    //    per variant) all pointing at the same storagePath, which made the
    //    gallery display the same hero image N times. The uploader and the
    //    gallery preset both key off `variant.featuredImageId`, not
    //    `ProductImage.variantId`, so the row can be product-level
    //    (variantId=null) without affecting variant→image association.
    //    imageType="hero-flat" stays the same (the review gallery component
    //    hard-filters rows with imageType="hero" as "raw, pre-processed").
    const prisma = getPrisma();
    const created = await prisma.productImage.create({
      data: {
        productId: group.productId,
        variantId: null, // product-level — shared by all sister variants
        sourceUrl: publicUrl,
        storagePath,
        fileName: `${group.groupKey}.png`,
        position: group.positionBase,
        downloadStatus: "downloaded",
        imageType: "hero-flat",
      },
    });
    await prisma.variant.updateMany({
      where: { id: { in: group.variants.map((v) => v.id) } },
      data: { featuredImageId: created.id },
    });

    return {
      ok: true,
      genSec: Math.round((Date.now() - tStart) / 1000),
      attached: group.variants.length,
    };
  } catch (err) {
    return {
      ok: false,
      genSec: Math.round((Date.now() - tStart) / 1000),
      attached: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  console.log(`=== Higgsfield CLI bulk-heroes ===`);
  console.log(`take=${args.take}  concurrency=${args.concurrency}  dryRun=${args.dryRun}\n`);

  // Pre-flight: positioning template must exist locally.
  if (!fs.existsSync(POSITIONING_TEMPLATE)) {
    console.error(`Positioning template missing at ${POSITIONING_TEMPLATE}. Aborting.`);
    process.exit(1);
  }

  // 1. Pick products: explicit --products list wins, else latest N from scrape jobs.
  const prisma = getPrisma();
  let products: Array<{ id: string; title: string; createdAt: Date }>;
  if (args.productIds && args.productIds.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: args.productIds } },
      select: { id: true, title: true, createdAt: true },
    });
    // Preserve the caller-specified order.
    const byId = new Map(rows.map((r) => [r.id, r]));
    products = args.productIds
      .map((id) => byId.get(id))
      .filter((p): p is { id: string; title: string; createdAt: Date } => !!p);
    const missing = args.productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      console.warn(`Warning: ${missing.length} product ID(s) not found: ${missing.join(", ")}`);
    }
  } else {
    const jobs = await prisma.scrapeJob.findMany({
      where: { product: { isNot: null } },
      orderBy: { createdAt: "desc" },
      take: args.take,
      include: { product: { select: { id: true, title: true, createdAt: true } } },
    });
    products = jobs
      .map((j) => j.product!)
      .filter((p): p is { id: string; title: string; createdAt: Date } => !!p);
  }
  if (products.length === 0) {
    console.error("No products selected. Nothing to do.");
    process.exit(1);
  }
  console.log(`Selected ${products.length} product(s):`);
  for (const p of products) {
    console.log(`  ${p.createdAt.toISOString()}  ${p.id}  ${p.title.slice(0, 70)}`);
  }
  console.log("");

  // 2. Build hero groups across all products.
  console.log(`Building hero pools...`);
  const allGroups: HeroGroup[] = [];
  const perProduct: Array<{ productId: string; title: string; groups: number; skipExisting: number; skipNoSource: number }> = [];
  for (const p of products) {
    const { groups, skipExisting, skipNoSource } = await buildHeroGroupsForProduct(p.id);
    allGroups.push(...groups);
    perProduct.push({
      productId: p.id,
      title: p.title,
      groups: groups.length,
      skipExisting,
      skipNoSource,
    });
    console.log(`  ${p.id}  groups=${groups.length}  alreadyHasHero=${skipExisting}  noSource=${skipNoSource}`);
  }
  console.log(`\nTotal unique hero generations to run: ${allGroups.length}`);
  console.log(`Expected wall (8-concurrent, ~45s each): ~${Math.ceil(allGroups.length / args.concurrency) * 45}s\n`);

  if (args.dryRun) {
    console.log("--dry-run set — exiting without generating.");
    await prisma.$disconnect();
    return;
  }
  if (allGroups.length === 0) {
    console.log("Nothing to generate (all groups already have heroes).");
    await prisma.$disconnect();
    return;
  }

  fs.mkdirSync(REF_CACHE_DIR, { recursive: true });
  fs.mkdirSync(OUT_CACHE_DIR, { recursive: true });

  // 3. Upload positioning template once (reused across all generations).
  console.log(`Uploading positioning template to Higgsfield...`);
  const tplStart = Date.now();
  const templateUploadId = await higgsfieldUpload(POSITIONING_TEMPLATE);
  console.log(`  template uploadId=${templateUploadId} (${Math.round((Date.now() - tplStart) / 1000)}s)\n`);

  // 4. Collapse HERO_PROMPT for CLI quoting (newlines break cmd.exe). For
  //    one-off prompt experiments (e.g. lights-OFF heroes for a single
  //    product), set HERO_PROMPT_OVERRIDE in the environment — the override
  //    is used verbatim and the canonical HERO_PROMPT is left untouched.
  const rawPrompt = process.env.HERO_PROMPT_OVERRIDE || HERO_PROMPT;
  if (process.env.HERO_PROMPT_OVERRIDE) {
    console.log(`[prompt] using HERO_PROMPT_OVERRIDE (${rawPrompt.length} chars)`);
  }
  const promptOneLine = rawPrompt.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  // 5. Fan out generations with concurrency cap.
  console.log(`Firing ${allGroups.length} generation(s) at concurrency=${args.concurrency}...`);
  const limit = makeLimit(args.concurrency);
  const t0 = Date.now();
  const results = await Promise.all(
    allGroups.map((g, idx) =>
      limit(async () => {
        const r = await runOneGroup(g, templateUploadId, promptOneLine);
        const tag = r.ok ? "OK" : "FAIL";
        const titleHead = g.productTitle.slice(0, 40);
        const varHead = g.variants[0].title.slice(0, 30);
        console.log(
          `  [${(idx + 1).toString().padStart(2)}/${allGroups.length}] ${tag} ${r.genSec}s  ${titleHead} / ${varHead}` +
            (r.error ? `\n         ${r.error.slice(0, 200)}` : ""),
        );
        return { group: g, ...r };
      }),
    ),
  );
  const totalSec = Math.round((Date.now() - t0) / 1000);

  // 6. Timing report.
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const totalAttached = ok.reduce((s, r) => s + r.attached, 0);
  const avgGen = ok.length > 0 ? Math.round(ok.reduce((s, r) => s + r.genSec, 0) / ok.length) : 0;

  // Per-product breakdown
  const byProduct = new Map<string, { ok: number; fail: number; sec: number }>();
  for (const r of results) {
    const cur = byProduct.get(r.group.productId) || { ok: 0, fail: 0, sec: 0 };
    if (r.ok) cur.ok++; else cur.fail++;
    cur.sec = Math.max(cur.sec, r.genSec); // approximate wall (per product) = slowest gen
    byProduct.set(r.group.productId, cur);
  }

  console.log(`\n========== TIMING REPORT ==========`);
  console.log(`Total wall: ${totalSec}s (${(totalSec / 60).toFixed(1)} min)`);
  console.log(`Heroes generated: ${ok.length}/${allGroups.length}  (avg gen: ${avgGen}s)`);
  console.log(`Variants attached: ${totalAttached}`);
  console.log(`Failures: ${fail.length}`);
  if (fail.length > 0) {
    console.log(`\nFailures:`);
    for (const f of fail) {
      console.log(`  ${f.group.productId} / ${f.group.variants[0].title.slice(0, 40)}: ${f.error}`);
    }
  }
  console.log(`\nPer product:`);
  for (const p of perProduct) {
    const stats = byProduct.get(p.productId);
    const okN = stats?.ok ?? 0;
    const failN = stats?.fail ?? 0;
    const slow = stats?.sec ?? 0;
    console.log(
      `  ${p.productId}  generated=${okN}/${p.groups}  failed=${failN}  alreadyHadHero=${p.skipExisting}  noSource=${p.skipNoSource}  slowestGen=${slow}s  ${p.title.slice(0, 60)}`,
    );
  }
  console.log(`\nReview URLs:`);
  for (const p of products) {
    console.log(`  http://localhost:3000/review/${p.id}`);
  }
  console.log(`====================================`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
