/**
 * One-off: generate hero images using Seedream 5 Lite image-to-image via kie,
 * with the user's Pottery-Barn-style detailed prompt (including IMPLIED SURFACE
 * section). NO post-process — direct upload as imageType="hero".
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/_hero-seedream-oneoff.ts <productId>
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

// ── env loader ───────────────────────────────────────────────────────────────
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
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

const KIE_ENDPOINT = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL_ENDPOINT = "https://api.kie.ai/api/v1/jobs/recordInfo";
const KIE_MODEL = "seedream/5-lite-image-to-image";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 5 * 60 * 1000;
const COST_PER_HERO_USD = 0.02; // Seedream 5 Lite basic, ~$0.02 per image at 2K
const KIE_API_KEY = process.env.KIE_API_KEY;
if (!KIE_API_KEY) throw new Error("KIE_API_KEY not set");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const HERO_PROMPT = `Luxury catalog product hero shot from the reference, Pottery Barn / Restoration Hardware style.

BACKGROUND: Soft warm off-white #EBEAE8 (NOT pure white). Subtle softbox falloff: brightest upper-right, ~10% dimmer lower-left, smooth gradient, no vignette ring. Reads as photographed seamless paper. NO wall, NO floor line, NO environmental context.

CAMERA: Square 1:1, 50mm lens, no distortion. Freestanding (table/floor/desk lamps, sconces): straight-on front view at eye-level, NO tilt. Ceiling fixtures (flush mount, pendants, chandeliers): slight-from-below 3/4 angle as if looking up; ceiling plane NOT visible.

FRAMING — anchored, never floating mid-frame:
- Hanging fixtures (chandeliers, sputniks, pendants, semi-flush with downward bulbs): CANOPY at ~20-28% from TOP of frame (NOT vertically centered). Bulb cluster / arms in upper-middle. ~35-45% of frame height BELOW the lowest bulb is empty backdrop — this gives the "hanging from above" read. Fixture anchors to the TOP via canopy.
- Flush mounts / low-profile rings: canopy at top of frame, body horizontally centered at vertical midpoint.
- Freestanding (table/floor/desk lamps, sconces): visual center of lamp body at vertical midpoint, base shadow grounding it at bottom.
- Visual mass (dense visible elements: bulbs, arms, shades, body — NOT empty hanging space) ~55-60% of frame's shorter dim.

LIGHTING: Soft three-quarter key from upper-right. No harsh highlights, no deep product shadows. Bulbs/LEDs ON, matching the EXACT color temperature of the reference (cool=cool, warm=warm — never default to warm). Light STRICTLY contained in shade/diffuser/LED. Backdrop stays #EBEAE8 — NO halo, NO concentric rings, NO warmth bleed.

SHADOWS + IMPLIED SURFACE (sells attachment, no floating-cutout look):
- Freestanding: soft elliptical contact shadow under base, ~115% base width × ~18% height, slight lower-left offset, ~25% darker than bg. Base reads as weight on an implied tabletop/floor.
- Ceiling: NO general drop shadow on bg. Canopy presses flush against implied ceiling at top of frame, narrow AO ONLY at canopy-ceiling interface (3-5% frame width). Hanging rods/chains drape with gravity.

PRODUCT FIDELITY: Preserve EXACT design, finish, color, proportions, material from reference. Every component visible. Metal finishes (brass, bronze, black, chrome) with correct specular. Glass/crystal/fabric with true translucency.

OUTPUT: One photograph, edge-to-edge, no text/watermarks/borders. Photographic realism.`;

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}
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
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callSeedream(sourceUrl: string): Promise<Buffer> {
  const createRes = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt: HERO_PROMPT,
        image_urls: [sourceUrl], // NOTE: image_urls (plural snake_case) for Seedream
        aspect_ratio: "1:1",
        quality: "basic",
        nsfw_checker: false,
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`kie createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { data?: { taskId?: string } };
  const taskId = created.data?.taskId;
  if (!taskId) throw new Error(`No taskId in response: ${JSON.stringify(created)}`);

  const start = Date.now();
  while (Date.now() - start < KIE_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
    const pollRes = await fetch(`${KIE_POLL_ENDPOINT}?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    if (!pollRes.ok) continue;
    const poll = (await pollRes.json()) as {
      data?: { state?: string; resultJson?: string; failMsg?: string };
    };
    const state = poll.data?.state;
    if (state === "success") {
      const rj = poll.data?.resultJson ? JSON.parse(poll.data.resultJson) : null;
      const url = rj?.resultUrls?.[0];
      if (!url) throw new Error(`kie success but no resultUrl: ${JSON.stringify(poll)}`);
      return await downloadBuffer(url);
    }
    if (state === "fail") {
      throw new Error(`kie task failed: ${poll.data?.failMsg ?? "unknown"}`);
    }
  }
  throw new Error("kie task timed out");
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  const supabase = getSupabase();
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: tsx _hero-nbp-oneoff.ts <productId>");
    process.exit(1);
  }

  const product = await getPrisma().product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    console.error(`Product ${productId} not found`);
    process.exit(1);
  }
  console.log(`Product: ${product.title.slice(0, 80)}`);
  console.log(`Visible variants: ${product.variants.length}`);

  // Build variant → source image map (with featuredImageId fallback)
  const nonHeroImages = product.images.filter((img) => img.imageType !== "hero");
  const imagesById = new Map(nonHeroImages.map((i) => [i.id, i]));
  const variantToImg = new Map<string, (typeof nonHeroImages)[number]>();
  for (const img of nonHeroImages) {
    if (img.variantId && !variantToImg.has(img.variantId)) variantToImg.set(img.variantId, img);
  }
  for (const v of product.variants) {
    if (variantToImg.has(v.id)) continue;
    if (v.featuredImageId) {
      const img = imagesById.get(v.featuredImageId);
      if (img) variantToImg.set(v.id, img);
    }
  }

  // Group variants by source image (dedup → one kie call per unique source)
  type Group = { sourceKey: string; sourceUrl: string; variants: typeof product.variants };
  const groups = new Map<string, Group>();
  const skipped: typeof product.variants = [];
  for (const v of product.variants) {
    const src = variantToImg.get(v.id);
    if (!src) {
      skipped.push(v);
      continue;
    }
    const sourceKey = src.storagePath || src.sourceUrl;
    const sourceUrl = src.storagePath ? publicSupabaseUrlFromPath(src.storagePath) : src.sourceUrl;
    if (!groups.has(sourceKey)) groups.set(sourceKey, { sourceKey, sourceUrl, variants: [] });
    groups.get(sourceKey)!.variants.push(v);
  }
  console.log(`Unique source images: ${groups.size}  Skipped variants: ${skipped.length}`);

  // Delete existing hero ProductImage rows so this run replaces them
  const existingHeroes = await getPrisma().productImage.findMany({
    where: { productId, imageType: "hero" },
    select: { id: true },
  });
  if (existingHeroes.length > 0) {
    console.log(`Deleting ${existingHeroes.length} existing hero row(s) before re-generating ...`);
    await getPrisma().productImage.deleteMany({
      where: { productId, imageType: "hero" },
    });
  }

  // Compute starting position for new hero rows (append)
  const maxPosAgg = await getPrisma().productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPos = (maxPosAgg._max.position ?? -1) + 1;

  const allGroups = [...groups.values()];
  console.log(`Running ${allGroups.length} group(s) in parallel ...`);
  const start = Date.now();
  let ok = 0;
  let fail = 0;
  const settled = await Promise.allSettled(
    allGroups.map(async (group, idx) => {
      const labelV = group.variants[0];
      const colorLabel = `${labelV.option1 ?? "-"} / ${labelV.option2 ?? "-"}`;
      const groupKey = (group.sourceKey.match(/\/([^/]+)\.[a-z]+$/i)?.[1] ?? `group-${idx}`).replace(/[^a-zA-Z0-9_-]/g, "_");
      try {
        const buf = await callSeedream(group.sourceUrl);
        const storagePath = `heroes/${productId}/${groupKey}.png`;
        const publicUrl = await uploadToSupabase(buf, storagePath);
        // Insert one ProductImage per sister variant, all pointing at the same file
        for (let i = 0; i < group.variants.length; i++) {
          const v = group.variants[i];
          const created = await getPrisma().productImage.create({
            data: {
              productId,
              variantId: v.id,
              sourceUrl: publicUrl,
              storagePath,
              fileName: `${groupKey}.png`,
              position: nextPos + idx * 10 + i,
              downloadStatus: "downloaded",
              imageType: "hero",
            },
          });
          await getPrisma().variant.update({
            where: { id: v.id },
            data: { featuredImageId: created.id },
          });
        }
        console.log(`  (${idx + 1}/${allGroups.length}) ${colorLabel} → OK`);
      } catch (err) {
        console.error(
          `  (${idx + 1}/${allGroups.length}) ${colorLabel} → FAIL: ${err instanceof Error ? err.message : err}`,
        );
        throw err;
      }
    }),
  );
  for (const r of settled) {
    if (r.status === "fulfilled") ok++;
    else fail++;
  }

  const wallS = ((Date.now() - start) / 1000).toFixed(1);
  const cost = (ok * COST_PER_HERO_USD).toFixed(2);
  console.log(
    `\nUnique heroes generated: ${ok}/${allGroups.length}  Failed: ${fail}  Wall time: ${wallS}s  Cost: ~$${cost}`,
  );
  console.log(`Review: /review/${productId}`);

  // ── Chain into post-process automatically (bg removal + flat #F0EFED bg
  //    + softbox gradient + feature-preserve erode + featuredImageId repoint).
  //    Skip with SKIP_POSTPROCESS=1. ───────────────────────────────────────
  if (process.env.SKIP_POSTPROCESS === "1") {
    console.log(`\nSKIP_POSTPROCESS=1 — skipping post-process step.`);
    return;
  }
  if (ok === 0) {
    console.log(`\nNo heroes generated — skipping post-process.`);
    return;
  }
  await getPrisma().$disconnect();
  _prisma = null;
  console.log(`\n→ Chaining post-process: BiRefNet bg removal + centered flat-bg composite ...`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "scripts/_postprocess-heroes.ts", productId],
      { stdio: "inherit", shell: true, cwd: process.cwd() },
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`post-process exited with code ${code}`));
    });
  });

  await getPrisma().$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
