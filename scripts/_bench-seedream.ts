/**
 * Pure timing benchmark for Seedream 5 Lite via kie with a CONDENSED version
 * of the Pottery-Barn prompt (full prompt exceeds Seedream's text limit).
 * Runs 6 parallel hero generations, uploads outputs to heroes-test-seedream/
 * (no DB writes). Reports per-call and total wall time.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";

function loadEnv() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const KIE_API_KEY = process.env.KIE_API_KEY!;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

// Condensed version of the full Pottery-Barn prompt with the new VISUAL MASS
// centering rule. Fits under Seedream's ~2k text limit.
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

const PRODUCT_ID = "cmp89ujrh00bcw26gma7aiml1";

async function fetchSources(): Promise<Array<{ label: string; url: string }>> {
  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) throw new Error("product not found");
  const nonHero = product.images.filter((i) => i.imageType !== "hero");
  const imgsById = new Map(nonHero.map((i) => [i.id, i]));
  const variantToImg = new Map<string, (typeof nonHero)[number]>();
  for (const img of nonHero) {
    if (img.variantId && !variantToImg.has(img.variantId)) variantToImg.set(img.variantId, img);
  }
  for (const v of product.variants) {
    if (variantToImg.has(v.id)) continue;
    if (v.featuredImageId) {
      const img = imgsById.get(v.featuredImageId);
      if (img) variantToImg.set(v.id, img);
    }
  }
  const seen = new Set<string>();
  const out: Array<{ label: string; url: string }> = [];
  for (const v of product.variants) {
    const src = variantToImg.get(v.id);
    if (!src) continue;
    const key = src.storagePath || src.sourceUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      label: (v.option1 ?? "var").replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").slice(0, 30),
      url: src.storagePath
        ? getSupabase().storage.from(BUCKET).getPublicUrl(src.storagePath).data.publicUrl
        : src.sourceUrl,
    });
  }
  await prisma.$disconnect();
  return out;
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

async function callSeedream(sourceUrl: string, label: string, started: number): Promise<Buffer> {
  const createRes = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "seedream/5-lite-image-to-image",
      input: {
        prompt: HERO_PROMPT,
        image_urls: [sourceUrl], // Seedream uses image_urls (plural snake_case)
        aspect_ratio: "1:1",
        quality: "basic",
        nsfw_checker: false,
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`createTask HTTP ${createRes.status}: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { data?: { taskId?: string } };
  const taskId = created.data?.taskId;
  if (!taskId) throw new Error(`No taskId: ${JSON.stringify(created)}`);

  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 5000));
    const poll = await (
      await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${KIE_API_KEY}` },
      })
    ).json();
    const state = poll.data?.state;
    if (state === "success") {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  [${label}] ✓ kie done in ${elapsed}s wall`);
      const rj = JSON.parse(poll.data.resultJson);
      return await downloadBuffer(rj.resultUrls[0]);
    }
    if (state === "fail") {
      throw new Error(`kie failed: ${poll.data?.failMsg ?? "unknown"}`);
    }
  }
  throw new Error("kie timeout");
}

async function main() {
  console.log(`Prompt length: ${HERO_PROMPT.length} chars`);
  console.log(`Fetching variant source URLs from DB ...`);
  const sources = await fetchSources();
  console.log(`Found ${sources.length} unique sources`);
  console.log(`Running ${sources.length} Seedream 5 Lite calls in parallel ...\n`);

  const startAll = Date.now();
  const settled = await Promise.allSettled(
    sources.map(async (s) => {
      const buf = await callSeedream(s.url, s.label, startAll);
      const url = await uploadToSupabase(buf, `heroes-test-seedream/${s.label}.png`);
      return { label: s.label, url };
    }),
  );
  const totalS = ((Date.now() - startAll) / 1000).toFixed(1);

  console.log(`\n========== Seedream 5 Lite BENCHMARK ==========`);
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      console.log(`  ${r.value.label}: ${r.value.url}`);
    } else {
      console.log(`  ${sources[i].label}: FAIL — ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }
  const okCount = settled.filter((r) => r.status === "fulfilled").length;
  console.log(
    `\nSucceeded: ${okCount}/${sources.length}  Total wall time: ${totalS}s`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
