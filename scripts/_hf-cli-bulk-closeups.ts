/**
 * Bulk close-up generator for a list of products via the Higgsfield CLI.
 * Per product, picks the lead visible variant's source reference image and
 * generates 2 close-up shots: one front-on macro of the lens/diffuser, one
 * 3/4-angle macro showing the housing edge + materials. Both land on the
 * same beige #ECE6DC studio backdrop the heroes use, so the gallery has a
 * consistent product-photography aesthetic.
 *
 * Persists as ProductImage rows with imageType="closeup", variantId=null
 * (closeups are product-level, not per-variant), positioned at the end of
 * the gallery — the gallery preset reorders them between lifestyles and
 * trailing heroes.
 *
 * Usage:
 *   npx tsx scripts/_hf-cli-bulk-closeups.ts --products id1,id2,...
 *   npx tsx scripts/_hf-cli-bulk-closeups.ts --products id1 --count 1
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const REF_CACHE = path.join(os.tmpdir(), "hf-cli-closeups", "refs");

const prisma = new PrismaClient();
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

// ── Higgsfield CLI (Windows-safe quoting) ───────────────────────────────────
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
  const m = raw.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error(`no JSON in CLI output: ${raw.slice(-200)}`);
  return JSON.parse(m[0]) as T;
}
async function higgsfieldUpload(file: string): Promise<string> {
  const r = await runHiggsfield(["upload", "create", file, "--json"]);
  if (r.code !== 0) throw new Error(`upload failed: ${r.out.slice(-200)}`);
  const p = extractJson<{ id?: string }>(r.out);
  if (!p.id) throw new Error(`upload returned no id: ${r.out.slice(-200)}`);
  return p.id;
}
function extractResultUrl(out: string): string | null {
  const urls = out.match(/https?:\/\/[^\s"',)]+\.(?:png|jpe?g|webp)/gi) || [];
  if (urls.length === 0) return null;
  const result = urls.find((u) => !u.includes("d2ol"));
  return result ?? urls[urls.length - 1];
}
async function downloadTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── Concurrency limiter ────────────────────────────────────────────────────
function makeLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((res) => queue.push(res));
    active++;
    try { return await fn(); }
    finally { active--; const n = queue.shift(); if (n) n(); }
  };
}

// ── Prompts (2 variations per product) ─────────────────────────────────────
// Universal — works for lighting, watches, jewellery boxes, bags, decor. Framing
// is ultra-tight (90-95% fill) to surface material texture and applied details
// the wider hero shot can't show. Watch closeups get an extra dial-text fidelity
// clause; everything else stays neutral.
const CLOSEUP_PROMPTS: Array<{ slug: string; prompt: string }> = [
  {
    slug: "front-detail",
    prompt:
      `Ultra-macro product close-up. Render the product so it looks VISUALLY IDENTICAL to the reference image — every surface, finish, colour, material, geometry, applied detail, printed marker, engraved character, and textile/metal/ceramic/leather grain must match the reference exactly. ` +
      `COMPOSITION — EXTREME TIGHT CROP: This is the tightest possible macro detail shot. The product fills 90-98% of the frame in BOTH width and height; portions of the product MAY crop out at the frame edges if needed to maintain that fill. Frame the single most visually distinctive surface — for a watch: the dial face with applied hour markers, hands, brand text, and date numeral; for a lamp: the diffuser / lens / emitter surface; for a leather or fabric product: the dominant texture / stitching / weave / seam; for a jewellery box: the velvet tray or hardware detail — straight-on so the material texture, surface grain, and applied details are razor-sharp and clearly readable. NO wide framing, NO negative space around the product. ` +
      `Camera: front-on, perfectly square to the product face. Square 1:1 frame. Macro lens equivalent (100mm), f/5.6 — product razor-sharp across the frame; the immediate backdrop softly out of focus behind it. ` +
      `Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC) — though almost none of the backdrop is visible because of the extreme crop. A continuous colour field with no horizon, no plane transitions, no architectural geometry. Soft contact shadow only (and barely visible at this crop). No specular hotspots. ` +
      `Scene lighting: Neutral 5500K daylight studio strobes — even, accurate colour rendering with a key light positioned to rake across the surface and reveal texture (brushed-metal directionality, leather pebble, fabric weave, ceramic insert grain). For lighting fixtures, the product's own emitters render exactly as in the reference image (off / dormant if the reference shows them off). ` +
      `Dial-text fidelity (when the product is a watch): the brand name on the dial, model designation, technical text rows (e.g. "OFFICIALLY CERTIFIED CHRONOMETER"), depth rating, and date numeral MUST be rendered LEGIBLY and IDENTICALLY to the reference — NOT blurred, NOT replaced with placeholder text, NOT swapped to a different brand, NOT translated, NOT softened. The whole point of this close-up is to make that text readable. ` +
      `Clean-render mandate (STRICT): REMOVE every reference-image text overlay, dimension callout, dimension arrow, dimension line, measurement label ("宽度", "高度", "mm"), spec table, Chinese character, supplier logo, supplier watermark, printed sticker, packaging label — except for text that is PART of the product itself (a watch dial's brand and model text, an engraved logo on the case, etc.), which MUST be preserved exactly. ` +
      `Photorealistic, sharp focus, no props, no people, no hands, no fabric drape, no presentation pad, no watch cushion / watch roll / watch holder (when the product is a watch). ` +
      `Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`,
  },
  {
    slug: "angle-detail",
    prompt:
      `Ultra-macro product close-up at a 3/4 angle. Render the product so it looks VISUALLY IDENTICAL to the reference image — every surface, finish, colour, material, geometry, applied detail, printed marker, engraved character, and grain must match the reference exactly. ` +
      `COMPOSITION — EXTREME TIGHT 3/4 CROP: This is the tightest possible macro detail shot from a 3/4 angle that reveals the product's edge, depth, and side profile. The product fills 85-95% of the frame in BOTH width and height. Frame so the most distinctive dimensional detail is centred — for a watch: the bezel-meets-case meets-crown corner, or the bracelet's brushed-centre vs polished-side link transition; for a lighting fixture: the housing edge, bezel thickness, ribbing; for a leather or fabric product: a corner with stitching / piping / hardware; for a jewellery box: the lid corner and hardware. NO wide framing, NO negative space around the product. ` +
      `Camera: 3/4 angle (about 30-45° off-axis). Square 1:1 frame. Macro lens equivalent (100mm), f/5.6 — product razor-sharp across the frame; the immediate backdrop softly out of focus behind it. ` +
      `Backdrop: Infinity cove studio backdrop, flat solid pale greige (hex #ECE6DC). A continuous colour field with no horizon, no plane transitions, no architectural geometry. Soft contact shadow only (barely visible at this crop). No specular hotspots. ` +
      `Scene lighting: Neutral 5500K daylight studio strobes — even, accurate colour rendering with a key light positioned to rake across the surface at the 3/4 angle and reveal texture (brushed-metal directionality, leather pebble, fabric weave, polished-side reflectivity). For lighting fixtures, the product's own emitters render exactly as in the reference image (off / dormant if the reference shows them off). ` +
      `Dial-text fidelity (when the product is a watch): any visible brand name, model designation, technical text rows, and date numeral MUST be rendered LEGIBLY and IDENTICALLY to the reference — NOT blurred, NOT replaced with placeholder text, NOT swapped. ` +
      `Clean-render mandate (STRICT): REMOVE every reference-image text overlay, dimension callout, measurement label ("宽度", "高度", "mm"), spec table, Chinese character (unless engraved onto the product itself), supplier logo, supplier watermark, printed sticker — preserve only text that is PART of the product itself. ` +
      `Photorealistic, sharp focus, no props, no people, no hands, no fabric drape, no presentation pad, no watch cushion / watch roll / watch holder (when the product is a watch). ` +
      `Positioning template: Image 2 is a positioning template — place the product inside the guide rectangle but do not show the rectangle in the final output.`,
  },
];

// ── Per-product close-up generation ────────────────────────────────────────
async function generateClosesForProduct(
  productId: string,
  templateUploadId: string,
  count: number,
): Promise<{ ok: number; fail: number; errors: string[] }> {
  // Find the lead visible variant's source image (same logic as the hero
  // pipeline — variantId-pinned image, then featuredImageId fallback).
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) throw new Error(`product ${productId} not found`);

  const sourceImages = product.images.filter(
    (img) => img.imageType !== "hero" && img.imageType !== "hero-flat" && img.imageType !== "lifestyle" && img.imageType !== "closeup",
  );
  const leadVariant = product.variants[0];
  if (!leadVariant) throw new Error(`product ${productId} has no visible variants`);

  let refImg = sourceImages.find((img) => img.variantId === leadVariant.id);
  if (!refImg && leadVariant.featuredImageId) {
    refImg = sourceImages.find((img) => img.id === leadVariant.featuredImageId);
  }
  if (!refImg) refImg = sourceImages[0];
  if (!refImg) throw new Error(`product ${productId} has no usable source image`);

  const refUrl = refImg.storagePath ? publicSupabaseUrlFromPath(refImg.storagePath) : refImg.sourceUrl;
  const refLocal = path.join(REF_CACHE, `${productId}.png`);
  if (!fs.existsSync(refLocal)) await downloadTo(refUrl, refLocal);
  const refUploadId = await higgsfieldUpload(refLocal);

  // Position base: append at the end of the existing gallery.
  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;

  // Idempotency: skip any slug that already has a ProductImage row for this
  // product. Lets re-runs only fill the missing close-ups instead of
  // clobbering successful prior generations.
  const existingClosesups = await prisma.productImage.findMany({
    where: { productId, imageType: "closeup" },
    select: { fileName: true },
  });
  const existingSlugs = new Set(
    existingClosesups
      .map((r) => r.fileName?.replace(/\.png$/i, ""))
      .filter((s): s is string => !!s),
  );

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const errors: string[] = [];
  const prompts = CLOSEUP_PROMPTS.slice(0, count);
  for (let i = 0; i < prompts.length; i++) {
    const { slug, prompt } = prompts[i];
    if (existingSlugs.has(slug)) {
      skipped++;
      console.log(`  ${productId}/${slug} → skip (already exists)`);
      continue;
    }
    try {
      const promptOneLine = prompt.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
      const inputImagesJson = JSON.stringify([
        { id: refUploadId, type: "media_input" },
        { id: templateUploadId, type: "media_input" },
      ]);
      const args = [
        "generate", "create", "nano_banana_2",
        "--prompt", promptOneLine,
        "--input_images", inputImagesJson,
        "--aspect_ratio", "1:1",
        "--resolution", "1k",
        "--wait",
      ];
      const r = await runHiggsfield(args);
      if (r.code !== 0) throw new Error(`generate exit ${r.code}: ${r.out.slice(-300)}`);
      const resultUrl = extractResultUrl(r.out);
      if (!resultUrl) throw new Error(`no result URL: ${r.out.slice(-300)}`);

      const outRes = await fetch(resultUrl);
      if (!outRes.ok) throw new Error(`download result ${outRes.status} ${resultUrl}`);
      const outBuf = Buffer.from(await outRes.arrayBuffer());

      const storagePath = `closeups/${productId}/${slug}.png`;
      const publicUrl = await uploadToSupabase(outBuf, storagePath);

      await prisma.productImage.create({
        data: {
          productId,
          variantId: null,
          sourceUrl: publicUrl,
          storagePath,
          fileName: `${slug}.png`,
          position: nextPosition++,
          downloadStatus: "downloaded",
          imageType: "closeup",
        },
      });
      ok++;
      console.log(`  ${productId}/${slug} → ok`);
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${slug}: ${msg.slice(0, 200)}`);
      console.log(`  ${productId}/${slug} → FAIL: ${msg.slice(0, 200)}`);
    }
  }
  return { ok, fail, errors };
}

function parseArgs(): { productIds: string[]; count: number } {
  const argv = process.argv.slice(2);
  let productIds: string[] = [];
  let count = 2;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--products") {
      const raw = argv[++i] ?? "";
      productIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--count") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0 && n <= 2) count = n;
    }
  }
  if (productIds.length === 0) {
    console.error("Usage: --products id1,id2,... [--count 1|2]");
    process.exit(1);
  }
  return { productIds, count };
}

(async () => {
  const { productIds, count } = parseArgs();
  fs.mkdirSync(REF_CACHE, { recursive: true });

  console.log(`Uploading positioning template once...`);
  const POSITIONING_TEMPLATE = path.join(os.tmpdir(), "scene", "v25-refs", "positioning-template.png");
  if (!fs.existsSync(POSITIONING_TEMPLATE)) {
    console.error(`Positioning template missing at ${POSITIONING_TEMPLATE}`);
    process.exit(1);
  }
  const templateUploadId = await higgsfieldUpload(POSITIONING_TEMPLATE);
  console.log(`  template uploadId=${templateUploadId}\n`);

  console.log(`Generating ${count} close-up(s) per product across ${productIds.length} product(s) in parallel...\n`);
  const limit = makeLimit(8);
  const t0 = Date.now();
  const results = await Promise.all(
    productIds.map((id) =>
      limit(() => generateClosesForProduct(id, templateUploadId, count)),
    ),
  );
  const elapsed = Math.round((Date.now() - t0) / 1000);
  const totalOk = results.reduce((s, r) => s + r.ok, 0);
  const totalFail = results.reduce((s, r) => s + r.fail, 0);
  console.log(`\n=== Closeups done in ${elapsed}s: ${totalOk} ok, ${totalFail} fail ===`);
  for (let i = 0; i < productIds.length; i++) {
    const r = results[i];
    console.log(`  ${productIds[i]}: ${r.ok}/${r.ok + r.fail}${r.errors.length > 0 ? ` — ${r.errors.join("; ")}` : ""}`);
  }
  await prisma.$disconnect();
})();
