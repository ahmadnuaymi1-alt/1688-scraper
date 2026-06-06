/**
 * Hero Image Creator — Mode A (local DB) + Mode B (live Shopify).
 *
 * Pipeline: drives the official Higgsfield CLI (`higgsfield generate create
 * nano_banana_2 …`) with the variant's source image + a positioning template
 * as two `media_input` references. Output is saved to Supabase and attached
 * as `ProductImage` rows with `imageType="hero-flat"` (the convention shared
 * with `_hf-cli-bulk-heroes.ts`).
 *
 * Usage:
 *   npx tsx scripts/_hero-image-creator.ts <productIdOrUrl> [--connection <id>] [--concurrency N]
 *
 * Auto-loads .env.local at startup so no special flag is needed.
 *
 * See .claude/skills/hero-image-creator/SKILL.md for full spec.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Buffer } from "node:buffer";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { higgsfieldUpload, higgsfieldGenerate, makeLimit } from "./_higgsfield-cli";
import {
  buildHeroPrompt,
  verifyAndMaybeRegenerate,
  printFailedVerifications,
  type FailedVerification,
} from "../src/lib/hero/verify";

// ─────────────────────────────────────────────────────────────────────────────
// 0) Lightweight .env.local loader — runs at module load.
//    Prisma + Supabase clients are constructed lazily so they always see env.
// ─────────────────────────────────────────────────────────────────────────────
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const COST_PER_HERO_USD = 0.02; // Higgsfield Ultra-plan amortized estimate
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const POSITIONING_TEMPLATE = path.join(
  os.tmpdir(),
  "scene",
  "v25-refs",
  "positioning-template.png",
);
const REF_CACHE_DIR = path.join(os.tmpdir(), "hero-cli", "refs");
const DEFAULT_CONCURRENCY = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing + mode detection
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  input: string;
  connectionId: string | null;
  concurrency: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/_hero-image-creator.ts <productIdOrUrl> [--connection <id>] [--concurrency N]",
    );
    process.exit(1);
  }
  let input = "";
  let connectionId: string | null = null;
  let concurrency = DEFAULT_CONCURRENCY;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--connection" && i + 1 < args.length) {
      connectionId = args[i + 1];
      i++;
    } else if (args[i] === "--concurrency" && i + 1 < args.length) {
      const n = parseInt(args[i + 1], 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
      i++;
    } else if (!input) {
      input = args[i];
    }
  }
  if (!input) {
    console.error("Missing <input> argument.");
    process.exit(1);
  }
  return { input, connectionId, concurrency };
}

type Mode =
  | { kind: "local"; productId: string }
  | { kind: "shopify"; productGid: string; storeDomain?: string };

function detectMode(input: string): Mode {
  // Review URL: localhost:PORT/review/<id> OR any /review/<id> path
  const reviewMatch = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (reviewMatch) return { kind: "local", productId: reviewMatch[1] };

  // Bare cuid (cuid v1 starts with 'c' and is 25 chars)
  if (/^c[a-z0-9]{24,}$/.test(input)) {
    return { kind: "local", productId: input };
  }

  // Shopify GID
  const gidMatch = input.match(/^gid:\/\/shopify\/Product\/(\d+)$/);
  if (gidMatch) return { kind: "shopify", productGid: input };

  // Shopify admin URL: https://<store>.myshopify.com/admin/products/<id>
  const adminMatch = input.match(
    /^https?:\/\/([^/]+\.myshopify\.com)\/admin\/products\/(\d+)/,
  );
  if (adminMatch) {
    return {
      kind: "shopify",
      productGid: `gid://shopify/Product/${adminMatch[2]}`,
      storeDomain: adminMatch[1],
    };
  }

  // Shopify storefront URL: https://<store>.myshopify.com/products/<handle> (not directly usable — need a query first)
  const storefrontMatch = input.match(
    /^https?:\/\/([^/]+\.myshopify\.com)\/products\/([A-Za-z0-9_-]+)/,
  );
  if (storefrontMatch) {
    // Will resolve via a productByHandle query
    return {
      kind: "shopify",
      productGid: `handle://${storefrontMatch[2]}`,
      storeDomain: storefrontMatch[1],
    };
  }

  console.error(
    `Could not detect mode from input "${input}". Expected a cuid, /review/<id> URL, Shopify product URL, or gid://shopify/Product/...`,
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Higgsfield CLI hero runner
// ─────────────────────────────────────────────────────────────────────────────
async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

/**
 * Download the source ref → upload it + positioning template to Higgsfield →
 * fire `generate create nano_banana_2 --wait` → download the result PNG.
 * Returns the raw image bytes + the local ref path (caller handles Supabase
 * upload + DB attach, and uses refLocal as the source for the match check).
 * Prompt is per-product: env override > hero-overrides/<id>.json > HERO_PROMPT.
 */
async function higgsfieldRunHero(
  sourceUrl: string,
  refKey: string,
  templateUploadId: string,
  productId: string,
  meta?: { title?: string; productType?: string | null },
): Promise<{ buffer: Buffer; refLocal: string }> {
  // 1. Cache the reference image on disk (CLI uploads from local file).
  const refLocal = path.join(REF_CACHE_DIR, `${refKey}.png`);
  if (!fs.existsSync(refLocal)) await downloadTo(sourceUrl, refLocal);
  // 2. Upload the ref. Positioning template upload is shared across the whole
  //    run — passed in by the caller.
  const refUploadId = await higgsfieldUpload(refLocal);
  // 3. Fire generation. higgsfieldGenerate collapses the prompt's newlines.
  //    title/type drive the lighting-vs-general prompt branch in buildHeroPrompt.
  const { imageBuffer } = await higgsfieldGenerate({
    prompt: buildHeroPrompt(productId, {
      title: meta?.title,
      productType: meta?.productType ?? undefined,
    }),
    inputUploadIds: [refUploadId, templateUploadId],
  });
  return { buffer: imageBuffer, refLocal };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase upload helper
// ─────────────────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function uploadToSupabase(buf: Buffer, storagePath: string): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  const supabase = getSupabase();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode A — Local-DB product
// ─────────────────────────────────────────────────────────────────────────────
async function runModeA(productId: string, concurrency: number): Promise<void> {
  if (!fs.existsSync(POSITIONING_TEMPLATE)) {
    console.error(`Positioning template missing at ${POSITIONING_TEMPLATE}. Aborting.`);
    process.exit(1);
  }
  fs.mkdirSync(REF_CACHE_DIR, { recursive: true });

  const product = await getPrisma().product.findUnique({
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

  console.log(`Mode A — local product`);
  console.log(`Product: ${product.title.slice(0, 80)}`);
  console.log(`Variants (visible): ${product.variants.length}`);

  // Heroes flagged by the Gemini source-match check (need per-product notes).
  const failedVerification: FailedVerification[] = [];
  const productTitle = product.title; // captured non-null for the nested processGroup closure
  const productType = product.productType; // captured for the lighting-vs-general hero branch

  // ── Variantless branch ───────────────────────────────────────────────
  // If the user has explicitly removed all variants (or scrape returned 0),
  // there's no variant→image grouping to do. Generate ONE hero from the
  // lowest-position non-hero image in the gallery (the "primary"), attach as
  // a product-level ProductImage (variantId: null).
  if (product.variants.length === 0) {
    const sourceImg = product.images
      .filter((img) => img.imageType !== "hero" && img.imageType !== "hero-flat")
      .sort((a, b) => a.position - b.position)[0];
    if (!sourceImg) {
      console.error(
        `Variantless product has no gallery image to use as the hero source. Add an image first.`,
      );
      return;
    }
    const existingHero = product.images.find(
      (img) =>
        (img.imageType === "hero" || img.imageType === "hero-flat") && !img.variantId,
    );
    if (existingHero) {
      console.log(`  Product-level hero already exists — skipping (idempotent).`);
      return;
    }
    const sourceUrl = sourceImg.storagePath
      ? publicSupabaseUrlFromPath(sourceImg.storagePath)
      : sourceImg.sourceUrl;
    const maxPosRow = await getPrisma().productImage.aggregate({
      where: { productId },
      _max: { position: true },
    });
    const nextPos = (maxPosRow._max.position ?? 0) + 1;
    console.log(`  Uploading positioning template to Higgsfield...`);
    const templateUploadId = await higgsfieldUpload(POSITIONING_TEMPLATE);
    const t0 = Date.now();
    try {
      const refKey = `${productId}__variantless`;
      const refLocal = path.join(REF_CACHE_DIR, `${refKey}.png`);
      const outcome = await verifyAndMaybeRegenerate({
        productId,
        productTitle: product.title,
        variantLabel: "(variantless)",
        sourceImage: refLocal,
        generate: async () =>
          (await higgsfieldRunHero(sourceUrl, refKey, templateUploadId, productId, { title: productTitle, productType })).buffer,
      });
      const buf = outcome.buffer;
      if (!outcome.passed && outcome.finalResult) {
        failedVerification.push({
          productId,
          productTitle: product.title,
          variantLabel: "(variantless)",
          attempts: outcome.attempts,
          result: outcome.finalResult,
          reviewUrl: `http://localhost:3000/review/${productId}`,
        });
      }
      const storagePath = `heroes/${productId}/variantless.png`;
      const publicUrl = await uploadToSupabase(buf, storagePath);
      await getPrisma().productImage.create({
        data: {
          productId,
          variantId: null,
          sourceUrl: publicUrl,
          storagePath,
          fileName: `variantless.png`,
          position: nextPos,
          downloadStatus: "downloaded",
          imageType: "hero-flat",
        },
      });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  variantless → OK (${elapsed}s)  Cost: ~$${COST_PER_HERO_USD.toFixed(2)}`);
      console.log(`Review: /review/${productId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  variantless → FAIL — ${msg}`);
    }
    printFailedVerifications(failedVerification);
    return;
  }

  // Filter out hero images in JS — Prisma's `{ NOT: { imageType: 'hero' } }`
  // is NULL-unsafe and would exclude rows where imageType IS NULL. Exclude
  // BOTH "hero" (legacy Kie pipeline output) AND "hero-flat" (CLI output of
  // this script) so a second run doesn't pick a previous hero as the source.
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
  // Fallback: some products only have the variant → image direction populated
  // (variant.featuredImageId), not image → variant. Backfill imagesByVariant
  // from variant.featuredImageId so those products still get heroes.
  for (const v of product.variants) {
    if (imagesByVariant.has(v.id)) continue;
    if (!v.featuredImageId) continue;
    const img = imagesById.get(v.featuredImageId);
    if (img) imagesByVariant.set(v.id, img);
  }

  const maxPosRow = await getPrisma().productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;

  // Group visible variants by their source image so we only run kie ONCE
  // per unique source. Two variants that share the same swatch image (e.g.
  // "Vintage Red / Rechargeable" + "Vintage Red / USB") get the same hero.
  type Group = {
    sourceKey: string;
    sourceUrl: string;
    variants: typeof product.variants;
  };
  const groups = new Map<string, Group>();
  const variantsWithoutSource: typeof product.variants = [];
  for (const v of product.variants) {
    const src = imagesByVariant.get(v.id);
    if (!src) {
      variantsWithoutSource.push(v);
      continue;
    }
    const sourceKey = src.storagePath || src.sourceUrl;
    const sourceUrl = src.storagePath
      ? publicSupabaseUrlFromPath(src.storagePath)
      : src.sourceUrl;
    const existing = groups.get(sourceKey);
    if (existing) {
      existing.variants.push(v);
    } else {
      groups.set(sourceKey, { sourceKey, sourceUrl, variants: [v] });
    }
  }

  console.log(`Unique source images: ${groups.size} (vs ${product.variants.length} visible variants)`);

  // Idempotency: skip groups where ANY sister variant already has a hero.
  // Re-runs only target the still-missing groups. Count BOTH "hero" (legacy)
  // AND "hero-flat" (what this CLI script writes).
  const variantsWithHero = new Set(
    product.images
      .filter(
        (img) =>
          (img.imageType === "hero" || img.imageType === "hero-flat") && img.variantId,
      )
      .map((img) => img.variantId as string),
  );

  let kieOkCount = 0;
  let variantsAttachedCount = 0;
  let skipCount = variantsWithoutSource.length;
  let skipExistingCount = 0;
  let failCount = 0;
  const t0 = Date.now();

  for (const v of variantsWithoutSource) {
    console.log(`  [${v.position}] ${v.title.slice(0, 60)} — SKIP (no source image)`);
  }

  // Filter groups that already have heroes BEFORE going parallel — pure
  // idempotent skip. Cheap.
  const allGroups = Array.from(groups.values());
  const toRun: Array<{ group: (typeof allGroups)[number]; idx: number; positionBase: number }> = [];
  let groupIdx = 0;
  for (const group of allGroups) {
    groupIdx++;
    const repVariant = group.variants[0];
    const colorLabel = repVariant.option1 || repVariant.title.slice(0, 40);
    if (group.variants.some((v) => variantsWithHero.has(v.id))) {
      console.log(`  (${groupIdx}/${allGroups.length}) ${colorLabel} → SKIP (hero already exists)`);
      skipExistingCount++;
      continue;
    }
    // Reserve N positions per group up-front so parallel tasks don't race on
    // the `nextPosition` counter.
    toRun.push({ group, idx: groupIdx, positionBase: nextPosition });
    nextPosition += group.variants.length;
  }

  if (toRun.length === 0) {
    console.log(`Nothing to generate — all visible variants already have heroes.`);
    return;
  }

  // Upload the positioning template ONCE per run — reused across every group.
  console.log(`Uploading positioning template to Higgsfield...`);
  const tplStart = Date.now();
  const templateUploadId = await higgsfieldUpload(POSITIONING_TEMPLATE);
  console.log(`  templateUploadId=${templateUploadId} (${Math.round((Date.now() - tplStart) / 1000)}s)`);

  console.log(`Running ${toRun.length} group(s) with concurrency=${concurrency}...`);
  const limit = makeLimit(concurrency);

  async function processGroup(item: (typeof toRun)[number]): Promise<{ ok: boolean; attached: number; label: string }> {
    const { group, idx, positionBase } = item;
    const repVariant = group.variants[0];
    const colorLabel = repVariant.option1 || repVariant.title.slice(0, 40);
    const variantStart = Date.now();
    try {
      const groupKey = group.sourceKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
      const refKey = `${productId}__${groupKey}`;
      const refLocal = path.join(REF_CACHE_DIR, `${refKey}.png`);
      const outcome = await verifyAndMaybeRegenerate({
        productId,
        productTitle,
        variantLabel: colorLabel,
        sourceImage: refLocal,
        generate: async () =>
          (await higgsfieldRunHero(group.sourceUrl, refKey, templateUploadId, productId, { title: productTitle, productType })).buffer,
      });
      const buf = outcome.buffer;
      if (!outcome.passed && outcome.finalResult) {
        failedVerification.push({
          productId,
          productTitle,
          variantLabel: colorLabel,
          attempts: outcome.attempts,
          result: outcome.finalResult,
          reviewUrl: `http://localhost:3000/review/${productId}`,
        });
      }
      const storagePath = `heroes/${productId}/${groupKey}.png`;
      const publicUrl = await uploadToSupabase(buf, storagePath);

      for (let i = 0; i < group.variants.length; i++) {
        const v = group.variants[i];
        const created = await getPrisma().productImage.create({
          data: {
            productId,
            variantId: v.id,
            sourceUrl: publicUrl,
            storagePath,
            fileName: `${groupKey}.png`,
            position: positionBase + i,
            downloadStatus: "downloaded",
            imageType: "hero-flat",
          },
        });
        await getPrisma().variant.update({
          where: { id: v.id },
          data: { featuredImageId: created.id },
        });
      }
      const elapsed = ((Date.now() - variantStart) / 1000).toFixed(1);
      console.log(`  (${idx}/${allGroups.length}) ${colorLabel} → OK (${elapsed}s)`);
      return { ok: true, attached: group.variants.length, label: colorLabel };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - variantStart) / 1000).toFixed(1);
      console.log(`  (${idx}/${allGroups.length}) ${colorLabel} → FAIL (${elapsed}s) — ${msg.slice(0, 120)}`);
      return { ok: false, attached: 0, label: colorLabel };
    }
  }

  const settled = await Promise.allSettled(toRun.map((item) => limit(() => processGroup(item))));
  for (const r of settled) {
    if (r.status === "fulfilled") {
      if (r.value.ok) {
        kieOkCount++;
        variantsAttachedCount += r.value.attached;
      } else {
        failCount++;
      }
    } else {
      failCount++;
    }
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = (kieOkCount * COST_PER_HERO_USD).toFixed(2);
  console.log("");
  console.log(
    `Unique heroes generated: ${kieOkCount}  Variants attached: ${variantsAttachedCount}  Skipped variants: ${skipCount}  Already-had-hero groups: ${skipExistingCount}  Failed groups: ${failCount}`,
  );
  console.log(`Wall time: ${totalElapsed}s   Cost: ~$${cost}`);
  console.log(`Review: /review/${productId}`);
  printFailedVerifications(failedVerification);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode B — Live Shopify product
// ─────────────────────────────────────────────────────────────────────────────
interface ShopifyVariantNode {
  id: string;
  title: string;
  image: { id: string; url: string } | null;
}

interface ShopifyProductResp {
  data?: {
    product?: {
      id: string;
      title: string;
      variants: { edges: Array<{ node: ShopifyVariantNode }> };
    } | null;
    productByHandle?: {
      id: string;
      title: string;
      variants: { edges: Array<{ node: ShopifyVariantNode }> };
    } | null;
  };
  errors?: unknown;
}

async function shopifyAdminFetch(
  storeDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<ShopifyProductResp> {
  const res = await fetch(`https://${storeDomain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify Admin HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as ShopifyProductResp;
}

async function runModeB(
  productGidOrHandle: string,
  storeDomainHint: string | undefined,
  connectionId: string | null,
  concurrency: number,
): Promise<void> {
  if (!fs.existsSync(POSITIONING_TEMPLATE)) {
    console.error(`Positioning template missing at ${POSITIONING_TEMPLATE}. Aborting.`);
    process.exit(1);
  }
  fs.mkdirSync(REF_CACHE_DIR, { recursive: true });

  const where = connectionId ? { id: connectionId } : { isDefault: true };
  const connection = await getPrisma().shopifyConnection.findFirst({ where });
  if (!connection) {
    console.error(
      "No ShopifyConnection found. Set up a connection in /settings or pass --connection <id>.",
    );
    process.exit(1);
  }
  const storeDomain = storeDomainHint || connection.storeDomain;
  console.log(`Mode B — Shopify (${storeDomain})`);

  let shopifyResp: ShopifyProductResp;
  if (productGidOrHandle.startsWith("handle://")) {
    const handle = productGidOrHandle.slice("handle://".length);
    shopifyResp = await shopifyAdminFetch(
      storeDomain,
      connection.accessToken,
      `query GetProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          variants(first: 100) {
            edges { node { id title image { id url } } }
          }
        }
      }`,
      { handle },
    );
  } else {
    shopifyResp = await shopifyAdminFetch(
      storeDomain,
      connection.accessToken,
      `query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          variants(first: 100) {
            edges { node { id title image { id url } } }
          }
        }
      }`,
      { id: productGidOrHandle },
    );
  }

  const product =
    shopifyResp.data?.product || shopifyResp.data?.productByHandle || null;
  if (!product) {
    console.error(
      `Shopify product not found. Errors: ${JSON.stringify(shopifyResp.errors).slice(0, 300)}`,
    );
    process.exit(1);
  }

  const variants = product.variants.edges.map((e) => e.node);
  console.log(`Product: ${product.title.slice(0, 80)}`);
  console.log(`Variants: ${variants.length}`);

  // Dedupe by image URL — variants sharing the same featured image get one
  // hero. Matches Mode A behavior.
  type SGroup = {
    sourceUrl: string;
    variants: ShopifyVariantNode[];
  };
  const groups = new Map<string, SGroup>();
  const variantsWithoutImage: ShopifyVariantNode[] = [];
  for (const v of variants) {
    if (!v.image?.url) {
      variantsWithoutImage.push(v);
      continue;
    }
    const key = v.image.id || v.image.url;
    const existing = groups.get(key);
    if (existing) existing.variants.push(v);
    else groups.set(key, { sourceUrl: v.image.url, variants: [v] });
  }
  console.log(`Unique source images: ${groups.size}`);

  const t0 = Date.now();
  const results: Array<{ variant: string; url: string }> = [];
  let kieOkCount = 0;
  let variantsAttachedCount = 0;
  let skipCount = variantsWithoutImage.length;
  let failCount = 0;

  const shopifyProductId = product.id.split("/").pop();

  for (const v of variantsWithoutImage) {
    console.log(`  [skip] ${v.title.slice(0, 60)} — SKIP (no image)`);
  }

  // One-time positioning-template upload reused across all groups.
  console.log(`Uploading positioning template to Higgsfield...`);
  const templateUploadId = await higgsfieldUpload(POSITIONING_TEMPLATE);

  const groupEntries = Array.from(groups.values()).map((group, i) => ({
    group,
    idx: i + 1,
    groupKey: (group.variants[0].image?.id || group.variants[0].id).split("/").pop() || `g${i + 1}`,
  }));
  console.log(`Running ${groupEntries.length} group(s) with concurrency=${concurrency}...`);
  const limit = makeLimit(concurrency);

  await Promise.all(
    groupEntries.map((entry) =>
      limit(async () => {
        const { group, idx, groupKey } = entry;
        const repVariant = group.variants[0];
        const variantStart = Date.now();
        try {
          const refKey = `shopify__${shopifyProductId}__${groupKey}`;
          const refLocal = path.join(REF_CACHE_DIR, `${refKey}.png`);
          const outcome = await verifyAndMaybeRegenerate({
            productId: shopifyProductId ?? "",
            productTitle: product.title,
            variantLabel: repVariant.title,
            sourceImage: refLocal,
            generate: async () =>
              (await higgsfieldRunHero(group.sourceUrl, refKey, templateUploadId, shopifyProductId ?? "", { title: product.title })).buffer,
          });
          if (!outcome.passed && outcome.finalResult) {
            console.log(`  [verify] ${repVariant.title.slice(0, 40)} flagged: ${outcome.finalResult.summary.slice(0, 100)}`);
          }
          const buf = outcome.buffer;
          const storagePath = `heroes/shopify/${shopifyProductId}/${groupKey}.png`;
          const publicUrl = await uploadToSupabase(buf, storagePath);
          const elapsed = ((Date.now() - variantStart) / 1000).toFixed(1);
          console.log(
            `  (${idx}/${groupEntries.length}) ${repVariant.title.slice(0, 50)} → OK (${elapsed}s, ${group.variants.length} variant(s) share this hero)`,
          );
          for (const sister of group.variants) {
            results.push({ variant: sister.title, url: publicUrl });
            variantsAttachedCount++;
          }
          kieOkCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(
            `  (${idx}/${groupEntries.length}) ${repVariant.title.slice(0, 50)} → FAIL — ${msg.slice(0, 120)}`,
          );
          failCount++;
        }
      }),
    ),
  );

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = (kieOkCount * COST_PER_HERO_USD).toFixed(2);
  console.log("");
  console.log(
    `Unique heroes generated: ${kieOkCount}  Variants attached: ${variantsAttachedCount}  Skipped variants: ${skipCount}  Failed groups: ${failCount}`,
  );
  console.log(`Wall time: ${totalElapsed}s   Cost: ~$${cost}`);
  console.log("");
  console.log("Hero URLs (one per variant — sister variants share the same URL):");
  for (const r of results) {
    console.log(`  - ${r.variant}: ${r.url}`);
  }
  console.log("");
  console.log(
    "These are NOT pushed to Shopify automatically. Upload via the existing UI flow if you want them on the live store.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { input, connectionId, concurrency } = parseArgs();
  const mode = detectMode(input);

  try {
    if (mode.kind === "local") {
      await runModeA(mode.productId, concurrency);
    } else {
      await runModeB(mode.productGid, mode.storeDomain, connectionId, concurrency);
    }
  } finally {
    await getPrisma().$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
