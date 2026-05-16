/**
 * Hero Image Creator — Mode A (local DB) + Mode B (live Shopify).
 *
 * Usage:
 *   npx tsx scripts/_hero-image-creator.ts <productIdOrUrl> [--connection <id>]
 *
 * Auto-loads .env.local at startup so no special flag is needed.
 *
 * See .claude/skills/hero-image-creator/SKILL.md for full spec.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const KIE_ENDPOINT = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL_ENDPOINT = "https://api.kie.ai/api/v1/jobs/recordInfo";
const KIE_MODEL = "seedream/5-lite-image-to-image";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 5 * 60 * 1000;
const COST_PER_HERO_USD = 0.02;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const HERO_PROMPT = `Generate an ecommerce catalog cutout of the product from the reference image. This is a packshot for a product grid, NOT a studio environment photograph.

BACKGROUND — TREAT AS A 2D FILL LAYER, NOT A 3D STUDIO PLANE:
- The background is a uniform Photoshop-style solid color fill, hex #D8D8D8, applied as a flat 2D overlay behind the subject.
- It is NOT a photographed cyclorama, NOT a backdrop, NOT a tabletop, NOT a wall, NOT seamless paper, NOT a 3D surface of any kind.
- EVERY background pixel MUST be the same #D8D8D8 tone — measured by an eyedropper, top-left, top-right, bottom-left, bottom-right, and center should all read the identical RGB value.
- ZERO ambient occlusion on the background. ZERO vignette. ZERO lighting falloff. ZERO warm/cool shift. ZERO gradient. ZERO bounce light from the product onto the background.
- The product is NOT casting any light onto the background. The product's own glow / illumination stays on the product surface only.

SHADOW:
- NO contact shadow. NO drop shadow. NO floor reflection. The subject sits on the flat color with no shadow whatsoever — like a sticker laid on a swatch.
- (Shadows generate gradients on the background, which violates the flat-fill rule. Skip them entirely.)

FRAMING — DEAD-CENTERED, EQUAL MARGINS:
- The subject's geometric bounding box center MUST be at exactly (50%, 50%) of the frame — measured from the bounding box of all visible product pixels.
- Equal padding on all four sides — top margin = bottom margin = left margin = right margin, each approximately 10-15% of the frame.
- Subject occupies ~70-80% of the frame's shorter dimension. Not cropped, not bleeding to any edge.

CAMERA:
- Square 1:1 frame.
- Eye-level front view. Camera height = product's vertical center. Camera distance = perpendicular to the product's main face.
- NO tilt, NO low-angle, NO three-quarter, NO foreshortening, NO overhead, NO perspective distortion.
- For a flush-mount ceiling light: render it head-on from below as if looking straight up at the ceiling. The mounting plate sits flat against the (invisible) ceiling, the light face is perpendicular to the camera.

PRODUCT FIDELITY:
- Preserve the EXACT product design, finish, color, proportions, and construction from the reference image — every component visible in the reference must appear in the output.
- For table lamps, floor lamps, bedside lamps, or any other free-standing lamp: do NOT show a power cable, charging cable, or USB cord anywhere in the frame. If the reference shows a cable, render the lamp as if it is cordless or the cable is fully tucked away. No visible cord, no cord shadow, no cord exit point at the base.

OUTPUT:
- ONE single image, edge-to-edge. If the product is a light, it is turned on (subject self-illumination only, never onto the background). No text, no watermarks, no UI overlays.`;

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing + mode detection
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  input: string;
  connectionId: string | null;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/_hero-image-creator.ts <productIdOrUrl> [--connection <id>]",
    );
    process.exit(1);
  }
  let input = "";
  let connectionId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--connection" && i + 1 < args.length) {
      connectionId = args[i + 1];
      i++;
    } else if (!input) {
      input = args[i];
    }
  }
  if (!input) {
    console.error("Missing <input> argument.");
    process.exit(1);
  }
  return { input, connectionId };
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
// kie.ai client
// ─────────────────────────────────────────────────────────────────────────────
interface KieCreateResp {
  code?: number;
  msg?: string;
  data?: { taskId?: string };
}

interface KiePollResp {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    state?: string; // "waiting" | "queuing" | "generating" | "success" | "fail"
    failCode?: string;
    failMsg?: string;
    resultJson?: string; // JSON-stringified { resultUrls: string[] }
  };
}

async function kieCreateTask(sourceUrl: string): Promise<string> {
  const token = process.env.KIE_API_KEY;
  if (!token) throw new Error("KIE_API_KEY not set in env");
  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt: HERO_PROMPT,
        image_urls: [sourceUrl],
        aspect_ratio: "1:1",
        quality: "basic",
        nsfw_checker: false,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`kie createTask HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as KieCreateResp;
  if (!json.data?.taskId) {
    throw new Error(`kie createTask returned no taskId: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json.data.taskId;
}

async function kiePoll(taskId: string): Promise<Buffer> {
  const token = process.env.KIE_API_KEY!;
  const start = Date.now();
  while (Date.now() - start < KIE_TIMEOUT_MS) {
    const res = await fetch(`${KIE_POLL_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
      continue;
    }
    const json = (await res.json()) as KiePollResp;
    const state = json.data?.state;
    if (state === "success") {
      const resultJsonRaw = json.data?.resultJson;
      if (!resultJsonRaw) throw new Error("kie poll: success but no resultJson");
      let urls: string[];
      try {
        const parsed = JSON.parse(resultJsonRaw) as { resultUrls?: string[] };
        urls = parsed.resultUrls ?? [];
      } catch {
        throw new Error(`kie poll: cannot parse resultJson "${String(resultJsonRaw).slice(0, 200)}"`);
      }
      if (urls.length === 0) throw new Error("kie poll: resultUrls empty");
      const imgRes = await fetch(urls[0]);
      if (!imgRes.ok) throw new Error(`kie poll: download HTTP ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    if (state === "fail") {
      const reason = json.data?.failMsg || json.data?.failCode || "unknown";
      throw new Error(`kie task failed: ${reason}`);
    }
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
  }
  throw new Error(`kie poll: timeout after ${KIE_TIMEOUT_MS / 1000}s`);
}

async function kieRunHero(sourceUrl: string): Promise<Buffer> {
  // One automatic retry on 5xx, otherwise surface.
  try {
    const taskId = await kieCreateTask(sourceUrl);
    return await kiePoll(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP 5\d\d/.test(msg)) {
      await new Promise((r) => setTimeout(r, 30_000));
      const taskId = await kieCreateTask(sourceUrl);
      return await kiePoll(taskId);
    }
    throw err;
  }
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
async function runModeA(productId: string): Promise<void> {
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

  // Filter out hero images in JS — Prisma's `{ NOT: { imageType: 'hero' } }`
  // is NULL-unsafe and would exclude rows where imageType IS NULL.
  const sourceImages = product.images.filter((img) => img.imageType !== "hero");
  const imagesByVariant = new Map<string, (typeof sourceImages)[number]>();
  for (const img of sourceImages) {
    if (!img.variantId) continue;
    if (!imagesByVariant.has(img.variantId)) imagesByVariant.set(img.variantId, img);
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
  // Re-runs only target the still-missing groups.
  const variantsWithHero = new Set(
    product.images
      .filter((img) => img.imageType === "hero" && img.variantId)
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

  console.log(`Running ${toRun.length} group(s) in parallel...`);

  async function processGroup(item: (typeof toRun)[number]): Promise<{ ok: boolean; attached: number; label: string }> {
    const { group, idx, positionBase } = item;
    const repVariant = group.variants[0];
    const colorLabel = repVariant.option1 || repVariant.title.slice(0, 40);
    const variantStart = Date.now();
    try {
      const buf = await kieRunHero(group.sourceUrl);
      const groupKey = group.sourceKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
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
            imageType: "hero",
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

  const settled = await Promise.allSettled(toRun.map(processGroup));
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
): Promise<void> {
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

  let groupIdx = 0;
  for (const group of groups.values()) {
    groupIdx++;
    const repVariant = group.variants[0];
    const groupKey = (repVariant.image?.id || repVariant.id).split("/").pop() || `g${groupIdx}`;
    const variantStart = Date.now();
    process.stdout.write(
      `  (${groupIdx}/${groups.size}) ${repVariant.title.slice(0, 50)} → ${group.variants.length} variant(s) ... `,
    );
    try {
      const buf = await kieRunHero(group.sourceUrl);
      const storagePath = `heroes/shopify/${shopifyProductId}/${groupKey}.png`;
      const publicUrl = await uploadToSupabase(buf, storagePath);
      const elapsed = ((Date.now() - variantStart) / 1000).toFixed(1);
      console.log(`OK (${elapsed}s, ${group.variants.length} variant(s) share this hero)`);
      for (const sister of group.variants) {
        results.push({ variant: sister.title, url: publicUrl });
        variantsAttachedCount++;
      }
      kieOkCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL — ${msg.slice(0, 120)}`);
      failCount++;
    }
  }

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
  const { input, connectionId } = parseArgs();
  const mode = detectMode(input);

  try {
    if (mode.kind === "local") {
      await runModeA(mode.productId);
    } else {
      await runModeB(mode.productGid, mode.storeDomain, connectionId);
    }
  } finally {
    await getPrisma().$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
