/**
 * Hero post-processor v2: color-shift bg + center subject (preserves glow).
 *
 * Proof of concept — does NOT touch _hero-image-creator.ts or the skill.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/_postprocess-heroes.ts <productId>
 *
 * Pipeline per hero:
 *   1. Download kie-generated hero PNG → RGB.
 *   2. Run briaai/RMBG-1.4 via @huggingface/transformers → soft alpha mask.
 *   3. Largest-connected-component cleanup on the mask (kills thin segmentation
 *      strays like the vertical bar we saw).
 *   4. Sample kie's bg color from "definitely background" pixels (cleaned
 *      alpha < 5%).
 *   5. Color-shift the bg: per pixel, shifted = original + (1 − alpha) × (target − sampled).
 *      Subject pixels (alpha=1) untouched. Bg pixels fully shifted to #D8D8D8.
 *      Glow halo (partial alpha) partially preserved — its delta from the
 *      sampled bg color is what makes it a glow, and that delta survives.
 *   6. Find subject bbox from cleaned mask.
 *   7. Scale the shifted image so subject's longest side = 75% of canvas.
 *   8. Pad with #D8D8D8 to extract a 2048×2048 region with subject dead-center.
 *   9. Upload to heroes-flat/{productId}/{groupKey}.png. Insert ProductImage row
 *      with imageType="hero-flat".
 *
 * Re-runs are idempotent: existing imageType="hero-flat" rows for the product
 * are deleted before processing, and Supabase storage uses upsert=true.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  AutoModel,
  AutoProcessor,
  RawImage,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

// BiRefNet — current SOTA for high-detail product segmentation. Confirmed
// to exist publicly on HF: onnx-community ports of ZhengPeng7's official
// BiRefNet weights. Full model is higher quality; lite is faster.
const RMBG_CANDIDATES = [
  "onnx-community/BiRefNet-ONNX", // full BiRefNet, best quality
  "onnx-community/BiRefNet_lite-ONNX", // lite variant, faster
  "briaai/RMBG-1.4", // last-resort fallback (u2net baseline)
];

let _rmbg: {
  model: PreTrainedModel;
  processor: Processor;
  identifier: string;
} | null = null;
async function getRmbg() {
  if (_rmbg) return _rmbg;
  let lastErr: unknown = null;
  for (const id of RMBG_CANDIDATES) {
    try {
      console.log(`Loading ${id} (one-time download on first run) ...`);
      const model = await AutoModel.from_pretrained(id);
      const processor = await AutoProcessor.from_pretrained(id);
      _rmbg = { model, processor, identifier: id };
      console.log(`✓ Loaded ${id}`);
      return _rmbg;
    } catch (err) {
      console.warn(
        `  ✗ ${id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      lastErr = err;
    }
  }
  throw new Error(
    `All bg-removal models failed to load. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

// ── env loader (mirrors _hero-image-creator.ts) ──────────────────────────────
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

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

// Catalog-grade hero settings (Pottery-Barn-aligned)
const CANVAS_SIZE = 1500;
const PADDING_RATIO = 0.12; // subject occupies ~76% of canvas's shorter dim (tighter zoom)
const TARGET_BG = { r: 240, g: 239, b: 237 }; // #F0EFED — airy off-white, slightly warm
const HALO_ERODE_PX = 12; // wider erode = less kie-gray bleed at the subject edges
const PRESERVE_ALPHA_MIN = 200; // pixels at or above this alpha are protected from erosion (saves thin solid features like brass arms)
const GRADIENT_LIGHT_X = 0.75; // softbox X (fraction of width)
const GRADIENT_LIGHT_Y = 0.25; // softbox Y (fraction of height)
const GRADIENT_DIM_MULT = 0.94; // ~6% falloff — gentle on the lighter bg

const BBOX_ALPHA_MIN = 200; // alpha > 200 counts as subject for bbox
const CLEANUP_ALPHA_MIN = 100; // alpha > 100 for connected-component analysis

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
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Run the bg-removal model and return the soft alpha mask at the source image's
// resolution, plus the RGB pixels of the source.
async function rmbgGetMask(rgbaBuf: Buffer): Promise<{
  rgb: Uint8Array;
  mask: Uint8Array;
  width: number;
  height: number;
}> {
  const { model, processor } = await getRmbg();

  const decoded = await sharp(rgbaBuf).removeAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const rgb = new Uint8Array(decoded.data);
  const width = decoded.info.width;
  const height = decoded.info.height;

  const rawImg = new RawImage(rgb, width, height, 3);
  const { pixel_values } = await processor(rawImg);

  // Different bg-removal models name their input tensor differently:
  //   RMBG-1.4 → "input"
  //   BiRefNet → "input_image"
  //   Some HF ports → "pixel_values"
  // Pass under all known names; ORT ignores extras and only validates required.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = await (model as any)({
    input: pixel_values,
    input_image: pixel_values,
    pixel_values,
  });

  // Find the saliency-mask tensor. Output key varies:
  //   BiRefNet → "output_image"
  //   RMBG-1.4 → "output"
  //   Others   → first tensor in dict
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isTensor(v: any): boolean {
    return v != null && typeof v === "object" && v.data && v.dims;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let maskTensor: any = null;
  const preferredKeys = ["output_image", "output", "logits", "pred", "out"];
  for (const k of preferredKeys) {
    if (result[k] && isTensor(result[k])) {
      maskTensor = result[k];
      break;
    }
  }
  if (!maskTensor) {
    for (const v of Object.values(result)) {
      if (isTensor(v)) {
        maskTensor = v;
        break;
      }
      if (Array.isArray(v) && v.length > 0 && isTensor(v[v.length - 1])) {
        maskTensor = v[v.length - 1];
        break;
      }
    }
  }
  if (!maskTensor) {
    throw new Error(
      `Could not find mask tensor in model output. Keys: ${Object.keys(result).join(", ")}`,
    );
  }

  // Dims = [batch, channel, modelH, modelW]. Channel is 1 for saliency models.
  const dims: number[] = maskTensor.dims;
  if (dims.length !== 4 || dims[1] !== 1) {
    throw new Error(
      `Unexpected mask tensor shape: ${JSON.stringify(dims)} — expected [1,1,H,W]`,
    );
  }
  const modelH = dims[2];
  const modelW = dims[3];
  const logits = maskTensor.data as Float32Array;

  // Auto-detect: if values exceed [0,1] meaningfully, they're raw logits →
  // apply sigmoid. Otherwise they're already probabilities.
  let isLogits = false;
  for (let i = 0; i < Math.min(logits.length, 256); i++) {
    if (logits[i] < -0.5 || logits[i] > 1.5) {
      isLogits = true;
      break;
    }
  }

  // Convert to Uint8 mask at model resolution.
  const modelMask = new Uint8Array(modelH * modelW);
  if (isLogits) {
    for (let i = 0; i < modelMask.length; i++) {
      const p = 1 / (1 + Math.exp(-logits[i]));
      modelMask[i] = Math.round(p * 255);
    }
  } else {
    for (let i = 0; i < modelMask.length; i++) {
      const p = logits[i];
      modelMask[i] = p <= 0 ? 0 : p >= 1 ? 255 : Math.round(p * 255);
    }
  }

  // Resize mask from model resolution to source resolution. Bypass sharp here
  // — sharp's single-channel raw → multi-channel resize behavior is finicky
  // and was silently producing RGB output that we then misread as 1-channel.
  // Bilinear in pure JS is fast enough and totally deterministic.
  const mask = bilinearResize8(modelMask, modelW, modelH, width, height);

  return { rgb, mask, width, height };
}

function bilinearResize8(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = sy - y0;
    const row0 = y0 * srcW;
    const row1 = y1 * srcW;
    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = sx - x0;
      const v00 = src[row0 + x0];
      const v01 = src[row0 + x1];
      const v10 = src[row1 + x0];
      const v11 = src[row1 + x1];
      const v =
        (1 - fx) * (1 - fy) * v00 +
        fx * (1 - fy) * v01 +
        (1 - fx) * fy * v10 +
        fx * fy * v11;
      dst[y * dstW + x] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return dst;
}

// Keep only the largest connected component (4-neighbor) above CLEANUP_ALPHA_MIN.
// Pixels not in that component get their mask value set to 0.
function keepLargestComponent(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const N = width * height;
  const visited = new Uint8Array(N);
  const compLabel = new Int32Array(N); // 0 = bg / unlabeled
  const queue = new Int32Array(N);

  let nextLabel = 1;
  let largestLabel = 0;
  let largestSize = 0;

  for (let seed = 0; seed < N; seed++) {
    if (visited[seed]) continue;
    if (mask[seed] <= CLEANUP_ALPHA_MIN) {
      visited[seed] = 1;
      continue;
    }
    // BFS
    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = seed;
    visited[seed] = 1;
    let size = 0;
    const label = nextLabel++;
    while (qHead < qTail) {
      const i = queue[qHead++];
      compLabel[i] = label;
      size++;
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) {
        const n = i - 1;
        if (!visited[n] && mask[n] > CLEANUP_ALPHA_MIN) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (x < width - 1) {
        const n = i + 1;
        if (!visited[n] && mask[n] > CLEANUP_ALPHA_MIN) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (y > 0) {
        const n = i - width;
        if (!visited[n] && mask[n] > CLEANUP_ALPHA_MIN) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
      if (y < height - 1) {
        const n = i + width;
        if (!visited[n] && mask[n] > CLEANUP_ALPHA_MIN) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      }
    }
    if (size > largestSize) {
      largestSize = size;
      largestLabel = label;
    }
  }

  const cleaned = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    cleaned[i] = compLabel[i] === largestLabel ? mask[i] : 0;
  }
  return cleaned;
}

function computeBbox(
  mask: Uint8Array,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] > BBOX_ALPHA_MIN) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1 };
}

// Separable morphological erosion on a single-channel mask. Shrinks all
// "on" regions inward by `radius` pixels. Used to crop out the warm halo
// bleed from lit fixtures (alpha mask shrinks → halo pixels become bg).
function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return mask;
  // Horizontal pass
  const horiz = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      let minV = 255;
      const xs = Math.max(0, x - radius);
      const xe = Math.min(width - 1, x + radius);
      for (let xx = xs; xx <= xe; xx++) {
        const v = mask[rowOff + xx];
        if (v < minV) minV = v;
      }
      horiz[rowOff + x] = minV;
    }
  }
  // Vertical pass
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minV = 255;
      const ys = Math.max(0, y - radius);
      const ye = Math.min(height - 1, y + radius);
      for (let yy = ys; yy <= ye; yy++) {
        const v = horiz[yy * width + x];
        if (v < minV) minV = v;
      }
      out[y * width + x] = minV;
    }
  }
  return out;
}

// Apply directional softbox falloff (per-pixel brightness multiplier) over
// an RGB buffer. Light position is (lx, ly) in pixel coords; dimMult is the
// brightness multiplier at the farthest corner.
function applySoftboxGradient(
  rgb: Buffer,
  width: number,
  height: number,
  lightX: number,
  lightY: number,
  dimMult: number,
): Buffer {
  // Max distance from light pos to any corner — for normalization.
  const dCorners = [
    Math.hypot(lightX, lightY),
    Math.hypot(width - lightX, lightY),
    Math.hypot(lightX, height - lightY),
    Math.hypot(width - lightX, height - lightY),
  ];
  const maxD = Math.max(...dCorners);
  const range = 1.0 - dimMult;
  const out = Buffer.alloc(rgb.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - lightX;
      const dy = y - lightY;
      const d = Math.hypot(dx, dy) / maxD;
      const mult = 1.0 - range * d;
      const i = (y * width + x) * 3;
      const r = rgb[i] * mult;
      const g = rgb[i + 1] * mult;
      const b = rgb[i + 2] * mult;
      out[i] = r < 0 ? 0 : r > 255 ? 255 : r | 0;
      out[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      out[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    }
  }
  return out;
}

async function processOne(args: {
  productId: string;
  variantId: string | null;
  fileName: string;
  groupKey: string;
  sourceUrl: string;
  position: number;
}): Promise<{
  newImageId: string;
  publicUrl: string;
} | null> {
  console.log(`  → ${args.fileName} : downloading ...`);
  const rawBuf = await downloadBuffer(args.sourceUrl);

  console.log(`  → ${args.fileName} : running BiRefNet ...`);
  const { rgb, mask: rawMask, width, height } = await rmbgGetMask(rawBuf);

  // Diagnostics
  let rawSubject = 0;
  let rawMaskMax = 0;
  for (let p = 0; p < rawMask.length; p++) {
    if (rawMask[p] > BBOX_ALPHA_MIN) rawSubject++;
    if (rawMask[p] > rawMaskMax) rawMaskMax = rawMask[p];
  }
  console.log(
    `  → ${args.fileName} : raw mask max=${rawMaskMax}, pixels>${BBOX_ALPHA_MIN}=${rawSubject}`,
  );

  // Step 1: largest-connected-component cleanup
  const cleanedMask = keepLargestComponent(rawMask, width, height);

  // Step 2: erode mask to kill warm halo bleed from lit fixtures
  const erodedMask = erodeMask(cleanedMask, width, height, HALO_ERODE_PX);

  // Step 3: conditional erode — restore any pixel where BiRefNet was confident
  // (alpha >= PRESERVE_ALPHA_MIN). Halo bleed is the soft-fringe alpha range
  // and stays eroded; confident solid features (thin arms, brackets, rims)
  // survive even if narrower than 2 * HALO_ERODE_PX.
  const mask = new Uint8Array(cleanedMask.length);
  for (let i = 0; i < cleanedMask.length; i++) {
    mask[i] = cleanedMask[i] >= PRESERVE_ALPHA_MIN ? cleanedMask[i] : erodedMask[i];
  }

  const bbox = computeBbox(mask, width, height);
  if (!bbox) {
    console.warn(`  ✗ ${args.fileName} : no subject pixels after erode — skipping`);
    return null;
  }
  const bboxW = bbox.x1 - bbox.x0 + 1;
  const bboxH = bbox.y1 - bbox.y0 + 1;
  console.log(
    `  → ${args.fileName} : bbox ${bboxW}×${bboxH} at (${bbox.x0},${bbox.y0})-(${bbox.x1},${bbox.y1})`,
  );

  // Step 3: build RGBA cutout at full source resolution (RGB + eroded alpha)
  const rgbaFull = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgbaFull[p * 4] = rgb[p * 3];
    rgbaFull[p * 4 + 1] = rgb[p * 3 + 1];
    rgbaFull[p * 4 + 2] = rgb[p * 3 + 2];
    rgbaFull[p * 4 + 3] = mask[p];
  }

  // Step 4: crop RGBA to bbox
  const croppedBuf = await sharp(rgbaFull, {
    raw: { width, height, channels: 4 },
  })
    .extract({ left: bbox.x0, top: bbox.y0, width: bboxW, height: bboxH })
    .png()
    .toBuffer();

  // Step 5: scale to fit in canvas with PADDING_RATIO margin
  const maxW = CANVAS_SIZE * (1 - 2 * PADDING_RATIO);
  const maxH = CANVAS_SIZE * (1 - 2 * PADDING_RATIO);
  const scale = Math.min(maxW / bboxW, maxH / bboxH);
  const scaledW = Math.max(1, Math.round(bboxW * scale));
  const scaledH = Math.max(1, Math.round(bboxH * scale));
  console.log(
    `  → ${args.fileName} : scale=${scale.toFixed(3)}, scaled subject=${scaledW}×${scaledH}, canvas=${CANVAS_SIZE}×${CANVAS_SIZE}`,
  );

  const scaledCutout = await sharp(croppedBuf)
    .resize(scaledW, scaledH, { kernel: "lanczos3" })
    .png()
    .toBuffer();

  // Step 6: build bg with gradient BAKED IN — every final has pixel-identical
  // bg at every coord. Subject then pastes on top UNCHANGED, so its kie tones
  // never blend with the gradient.
  const lightX = CANVAS_SIZE * GRADIENT_LIGHT_X;
  const lightY = CANVAS_SIZE * GRADIENT_LIGHT_Y;
  const maxD = Math.max(
    Math.hypot(lightX, lightY),
    Math.hypot(CANVAS_SIZE - lightX, lightY),
    Math.hypot(lightX, CANVAS_SIZE - lightY),
    Math.hypot(CANVAS_SIZE - lightX, CANVAS_SIZE - lightY),
  );
  const range = 1.0 - GRADIENT_DIM_MULT;
  const bgRgb = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 3);
  for (let py = 0; py < CANVAS_SIZE; py++) {
    for (let px = 0; px < CANVAS_SIZE; px++) {
      const d = Math.hypot(px - lightX, py - lightY) / maxD;
      const mult = 1.0 - range * d;
      const i = (py * CANVAS_SIZE + px) * 3;
      const r = TARGET_BG.r * mult;
      const g = TARGET_BG.g * mult;
      const b = TARGET_BG.b * mult;
      bgRgb[i] = r > 255 ? 255 : r | 0;
      bgRgb[i + 1] = g > 255 ? 255 : g | 0;
      bgRgb[i + 2] = b > 255 ? 255 : b | 0;
    }
  }

  // Step 7: composite cutout centered onto gradient bg
  const x = Math.round((CANVAS_SIZE - scaledW) / 2);
  const y = Math.round((CANVAS_SIZE - scaledH) / 2);
  const finalBuf = await sharp(bgRgb, {
    raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 3 },
  })
    .composite([{ input: scaledCutout, left: x, top: y }])
    .jpeg({ quality: 92 })
    .toBuffer();

  const storagePath = `heroes-flat/${args.productId}/${args.groupKey}.jpg`;
  console.log(`  → ${args.fileName} : uploading ...`);
  const publicUrl = await uploadToSupabaseJpeg(finalBuf, storagePath);

  const inserted = await getPrisma().productImage.create({
    data: {
      productId: args.productId,
      variantId: args.variantId,
      sourceUrl: publicUrl,
      storagePath,
      fileName: `${args.groupKey}-flat.jpg`,
      position: args.position,
      downloadStatus: "downloaded",
      imageType: "hero-flat",
    },
  });
  // Repoint the variant's featuredImageId to the polished hero-flat so the
  // Variants table thumbnail uses the final version, not the raw kie output.
  if (args.variantId) {
    await getPrisma().variant.update({
      where: { id: args.variantId },
      data: { featuredImageId: inserted.id },
    });
  }
  return { newImageId: inserted.id, publicUrl };
}

async function uploadToSupabaseJpeg(buf: Buffer, storagePath: string): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function main() {
  const productId = process.argv[2];
  if (!productId) {
    console.error("Usage: tsx _postprocess-heroes.ts <productId>");
    process.exit(1);
  }

  const product = await getPrisma().product.findUnique({
    where: { id: productId },
    include: {
      images: { orderBy: { position: "asc" } },
    },
  });
  if (!product) {
    console.error(`Product ${productId} not found.`);
    process.exit(1);
  }

  // Idempotent: delete any prior hero-flat rows so re-runs don't accumulate
  // duplicates. Supabase storage objects at heroes-flat/... will be overwritten
  // via upsert=true.
  const stale = product.images.filter((img) => img.imageType === "hero-flat");
  if (stale.length > 0) {
    console.log(`Deleting ${stale.length} stale hero-flat row(s) before re-run ...`);
    await getPrisma().productImage.deleteMany({
      where: { productId, imageType: "hero-flat" },
    });
  }

  const heroes = product.images.filter((img) => img.imageType === "hero");
  if (heroes.length === 0) {
    console.error("No imageType=hero rows on this product — nothing to process.");
    process.exit(1);
  }

  console.log(`Product: ${product.title}`);
  console.log(`Heroes to post-process: ${heroes.length}`);

  const maxPosAgg = await getPrisma().productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPos = (maxPosAgg._max.position ?? -1) + 1;

  const start = Date.now();
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < heroes.length; i++) {
    const h = heroes[i];
    const fileName = h.fileName ?? `hero-${i}.png`;
    const groupKey =
      (h.storagePath && h.storagePath.match(/\/([^/]+)\.png$/)?.[1]) ||
      fileName.replace(/\.png$/, "") ||
      `hero-${i}`;
    console.log(`\n[${i + 1}/${heroes.length}] ${fileName}`);
    try {
      const res = await processOne({
        productId,
        variantId: h.variantId,
        fileName,
        groupKey,
        sourceUrl: h.sourceUrl,
        position: nextPos++,
      });
      if (res) {
        console.log(`  ✓ done — ${res.publicUrl}`);
        okCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      console.error(
        `  ✗ failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      failCount++;
    }
  }

  const wallS = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\nPost-processed: ${okCount}/${heroes.length}  Failed: ${failCount}  Wall time: ${wallS}s  Cost: $0 (local model)`,
  );
  console.log(`Review: /review/${productId}`);

  await getPrisma().$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
