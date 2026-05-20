/**
 * One-off: generate hero images using gpt-image-2-image-to-image via kie,
 * with the user's full Pottery-Barn-style detailed prompt. NO post-process.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/_hero-gpt-oneoff.ts <productId>
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
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
const KIE_MODEL = "gpt-image-2-image-to-image";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 10 * 60 * 1000;
const KIE_RESOLUTION = "1K"; // Set to "2K" for higher detail (~2.25x cost)
const KIE_API_KEY = process.env.KIE_API_KEY;
if (!KIE_API_KEY) throw new Error("KIE_API_KEY not set");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

const HERO_PROMPT = `Generate a luxury catalog product hero shot of the product from the reference image, in the visual style of Pottery Barn, Crate & Barrel, Restoration Hardware, and Visual Comfort product photography.

BACKGROUND:
- Soft off-white backdrop, hex #EBEAE8 (warm-tinted light grey, NOT pure neutral, NOT bright white).
- Subtle directional softbox falloff: brightest in the upper-right quadrant, gently falling off toward the lower-left by approximately 10–12% in brightness. Smooth, imperceptible gradient — no harsh edges, no vignette ring, no hot spots.
- Surface reads as a real photographed seamless paper backdrop, not a flat digital fill.
- No wall, no floor line, no textured material, no environmental context.

CAMERA:
- For freestanding products (table lamps, floor lamps, desk lamps, sconces): front view at eye-level with the product's vertical center. No tilt, no foreshortening. Straight-on, dead-honest perspective.
- For ceiling-mounted fixtures (flush mount, semi-flush, pendants, chandeliers): slight-from-below 3/4 angle, as if the viewer is standing in the room looking up at the mounted fixture. Show both the underside AND a clear view of the fixture's profile. The ceiling plane itself is NOT visible — only the fixture against the backdrop.
- Square 1:1 frame.
- Standard 50mm-equivalent lens character: no wide-angle distortion, no telephoto compression.

FRAMING:
- Product's geometric center placed at the exact horizontal AND vertical center of the frame.
- Product occupies roughly 60–65% of the frame's shorter dimension. Generous breathing room on all sides — premium catalog framing is about negative space, not crowding the edges.
- Symmetric padding: equal margin top/bottom and left/right.

LIGHTING:
- Soft, diffused studio light coming from upper-right (consistent with the backdrop falloff direction).
- Three-quarter key light on the product, no harsh highlights or blown-out reflections, no deep shadows on the product itself.
- For lit products (lamps, fixtures with bulbs): the internal bulb/LED is ON, matching the EXACT color temperature shown in the reference image. If the reference shows a cool/white LED, output a cool/white LED. If the reference shows a warm bulb, output a warm bulb. Do NOT default to warm — preserve the reference's color temperature precisely.
- The light is STRICTLY CONTAINED within the shade, diffuser, or LED housing. The backdrop behind the fixture must remain at the specified #EBEAE8 hex, unmodified. NO halo on the backdrop. NO concentric rings, NO glow patterns, NO radial light spread, NO reflected ambient warmth on the surrounding surface. The fixture appears to be photographed against a clean studio backdrop, NOT mounted in an actual ceiling environment. Any warmth in the scene exists ONLY inside the fixture's own shade or LED ring — the backdrop is not part of the lighting environment.

SHADOW:
- For freestanding products: soft elliptical contact shadow directly beneath the base, slightly offset toward the lower-left (consistent with the upper-right light source). Shadow is approximately 110–120% of the base width, 15–20% of the base diameter in vertical extent, soft-edged with gradual falloff. Maximum darkness at the shadow's center is roughly 25% darker than the backdrop — visible but never heavy. NO hard shadow line, NO projected floor reflection, NO secondary cast shadow on the backdrop.
- For ceiling-mounted fixtures: subtle soft halo of ambient occlusion around the fixture's perimeter, simulating the fixture's proximity to an implied ceiling surface. No more than 8% of frame width from the fixture edge. No directional drop shadow, no warm color tint — only a gentle neutral-grey darkening that grounds the fixture in space without altering the backdrop's color.

PRODUCT FIDELITY:
- Preserve the EXACT product design, finish, color, proportions, material, and construction from the reference image.
- Every component visible in the reference must appear in the output: every screw, every joint, every decorative element, every finish detail.
- Metal finishes (brass, bronze, brushed nickel, matte black, chrome) must read as the correct material with appropriate specular highlights and surface character. No flattening, no plastic-looking shortcuts.
- Glass, crystal, fabric shades must show their actual translucency, weave, and refraction behavior.

OUTPUT:
- One single photograph, edge-to-edge, no text, no watermarks, no UI overlays, no borders, no logos.
- High resolution, sharp focus across the entire product.
- Photographic realism — should be indistinguishable from a real studio shoot at a glance.`;

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

async function callGpt(sourceUrl: string): Promise<Buffer> {
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
        image_input: [sourceUrl],
        size: "1024x1024", // gpt-image supports 1024x1024 / 1536x1024 / 1024x1536
        quality: "high",
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

  // Idempotent: skip groups where ANY sister variant already has a hero.
  // This lets us retry only the failed groups without redoing the OKs.
  const heroesByVariant = new Set<string>(
    (
      await getPrisma().productImage.findMany({
        where: { productId, imageType: "hero" },
        select: { variantId: true },
      })
    )
      .map((i) => i.variantId)
      .filter((id): id is string => id !== null),
  );

  // Compute starting position for new hero rows (append)
  const maxPosAgg = await getPrisma().productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPos = (maxPosAgg._max.position ?? -1) + 1;

  const allGroups = [...groups.values()].filter((g) => {
    const allHaveHero = g.variants.every((v) => heroesByVariant.has(v.id));
    if (allHaveHero) {
      console.log(`  SKIP group ${g.variants[0].option1 ?? "-"} — all sister variants already have heroes`);
      return false;
    }
    return true;
  });
  console.log(`Running ${allGroups.length} group(s) in parallel (skipped ${groups.size - allGroups.length} already-done) ...`);
  const start = Date.now();
  let ok = 0;
  let fail = 0;
  const settled = await Promise.allSettled(
    allGroups.map(async (group, idx) => {
      const labelV = group.variants[0];
      const colorLabel = `${labelV.option1 ?? "-"} / ${labelV.option2 ?? "-"}`;
      const groupKey = (group.sourceKey.match(/\/([^/]+)\.[a-z]+$/i)?.[1] ?? `group-${idx}`).replace(/[^a-zA-Z0-9_-]/g, "_");
      try {
        const buf = await callGpt(group.sourceUrl);
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
  const cost = (ok * 0.04).toFixed(2);
  console.log(
    `\nUnique heroes generated: ${ok}/${allGroups.length}  Failed: ${fail}  Wall time: ${wallS}s  Cost: ~$${cost}`,
  );
  console.log(`Review: /review/${productId}`);

  await getPrisma().$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
