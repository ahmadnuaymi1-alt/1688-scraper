/**
 * Hero pipeline regression test — generates 3 heroes with the new prompt + new
 * post-process, saves to heroes-test/ (no DB rows, no existing-hero impact).
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/_regression-test-heroes.ts
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  AutoModel,
  AutoProcessor,
  RawImage,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

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
const KIE_ENDPOINT = "https://api.kie.ai/api/v1/jobs/createTask";
const KIE_POLL_ENDPOINT = "https://api.kie.ai/api/v1/jobs/recordInfo";
const KIE_MODEL = "seedream/5-lite-image-to-image";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 5 * 60 * 1000;
const KIE_API_KEY = process.env.KIE_API_KEY;
if (!KIE_API_KEY) throw new Error("KIE_API_KEY not set");

// Match _hero-image-creator.ts (verbatim copy of updated prompt)
const HERO_PROMPT = `Generate a luxury studio product hero shot of the product from the reference image.

BACKGROUND:
- Neutral light backdrop (model output will be replaced in post — focus on producing a clean fixture cutout). Do not render a ceiling plane, wall, floor, paper-curve seamless, or any environmental surface other than a clean neutral backdrop.

CAMERA / ANGLE — SIMPLE FRONT VIEW (Pottery Barn catalog style, identical across every variant):
- Camera position: straight-on front view. Eye-level. Camera lens perpendicular to the product's main face.
- ZERO tilt. ZERO 3/4 angle. ZERO perspective foreshortening. ZERO looking-up or looking-down.
- The product reads as a flat, head-on portrait: no top surface visible (for freestanding products), no underside visible (for ceiling fixtures). Just the main face square-on to the camera.
- This is the same angle for every variant in a product AND every variant across products — total consistency.
- Square 1:1 frame.

FRAMING:
- Fixture's geometric center placed at the exact horizontal AND vertical center of the frame.
- Fixture's silhouette occupies ~60-70% of the frame's shorter dimension.

LIGHT STATE (if the product is a light fixture):
- Fixture shown lit with a subtle warm internal glow only.
- Light must be contained within the shade, diffuser, or LED ring — no spill, halo, or warm color cast onto the surrounding background.
- The backdrop must remain neutral; warmth lives inside the fixture, not on the wall behind it.

SHADOW:
- For freestanding products: soft subtle contact shadow directly beneath the base only, no longer than ~10% of frame height, soft-edged.
- For ceiling fixtures: no shadow needed.

PRODUCT FIDELITY:
- Preserve the EXACT product design, finish, color, proportions, and construction from the reference image. Every visible component in the reference must appear in the output.
- For table lamps, floor lamps, bedside lamps, or any other free-standing lamp: do NOT show a power cable, charging cable, or USB cord anywhere in the frame. If the reference shows a cable, render the lamp as if it is cordless or the cable is fully tucked away.

OUTPUT:
- One single photograph, edge-to-edge, no text, no watermarks, no UI overlays.`;

// Post-process settings (match _postprocess-heroes.ts)
const CANVAS_SIZE = 1500;
const PADDING_RATIO = 0.20;
const TARGET_BG = { r: 240, g: 239, b: 237 }; // #F0EFED — airy off-white
const HALO_ERODE_PX = 12; // wider erode = less kie-gray bleed at the subject edges
const GRADIENT_LIGHT_X = 0.75;
const GRADIENT_LIGHT_Y = 0.25;
const GRADIENT_DIM_MULT = 0.94; // ~6% falloff — gentle on the lighter bg
const BBOX_ALPHA_MIN = 200;
const CLEANUP_ALPHA_MIN = 100;
const RMBG_MODEL = "onnx-community/BiRefNet-ONNX";

const TEST_CASES = [
  // The 4 unique-image groups of cmp89k2qu0073w26gtxwlnrot — same fixture shape
  // family, different color/finish. Used to validate the GEOMETRIC LOCK rules.
  {
    label: "1-AtelierSquareGold",
    sourceUrl:
      "https://cbu01.alicdn.com/img/ibank/O1CN01l4U9Q42AX9UzIaz1x_!!2218665968212-0-cib.jpg",
  },
  {
    label: "2-AtelierSquareBlack",
    sourceUrl:
      "https://cbu01.alicdn.com/img/ibank/O1CN01Ks8XoT2AX9V0Kht1L_!!2218665968212-0-cib.jpg",
  },
  {
    label: "3-HaloRoundGold",
    sourceUrl:
      "https://cbu01.alicdn.com/img/ibank/O1CN01RP6Yhx2AX9V5kLhTL_!!2218665968212-0-cib.jpg",
  },
  {
    label: "4-HaloRoundBlack",
    sourceUrl:
      "https://cbu01.alicdn.com/img/ibank/O1CN01f5CKAu2AX9V3drGTN_!!2218665968212-0-cib.jpg",
  },
];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function uploadToSupabase(buf: Buffer, storagePath: string, contentType: string): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function callKie(sourceUrl: string): Promise<Buffer> {
  console.log(`  kie → generating with new prompt for ${sourceUrl} ...`);
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
        image_urls: [sourceUrl],
        aspect_ratio: "1:1",
        quality: "basic",
        nsfw_checker: false,
      },
    }),
  });
  if (!createRes.ok) {
    throw new Error(`kie createTask failed: HTTP ${createRes.status}: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { code?: number; data?: { taskId?: string } };
  const taskId = created.data?.taskId;
  if (!taskId) throw new Error(`kie createTask returned no taskId: ${JSON.stringify(created)}`);

  const start = Date.now();
  while (Date.now() - start < KIE_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
    const pollRes = await fetch(`${KIE_POLL_ENDPOINT}?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    if (!pollRes.ok) continue;
    const poll = (await pollRes.json()) as { data?: { state?: string; resultJson?: string; failMsg?: string } };
    const state = poll.data?.state;
    if (state === "success") {
      const rj = poll.data?.resultJson ? JSON.parse(poll.data.resultJson) : null;
      const url = rj?.resultUrls?.[0];
      if (!url) throw new Error(`kie success but no resultUrl: ${JSON.stringify(poll)}`);
      console.log(`  kie → done in ${((Date.now() - start) / 1000).toFixed(1)}s, fetching ${url}`);
      return await downloadBuffer(url);
    }
    if (state === "fail") {
      throw new Error(`kie task failed: ${poll.data?.failMsg ?? "unknown"}`);
    }
  }
  throw new Error("kie task timed out");
}

// ─── BiRefNet ───────────────────────────────────────────────────────────────
let _rmbg: { model: PreTrainedModel; processor: Processor } | null = null;
async function getRmbg() {
  if (_rmbg) return _rmbg;
  console.log(`Loading ${RMBG_MODEL} ...`);
  const model = await AutoModel.from_pretrained(RMBG_MODEL);
  const processor = await AutoProcessor.from_pretrained(RMBG_MODEL);
  _rmbg = { model, processor };
  return _rmbg;
}

function bilinearResize8(src: Uint8Array, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
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
      const v =
        (1 - fx) * (1 - fy) * src[row0 + x0] +
        fx * (1 - fy) * src[row0 + x1] +
        (1 - fx) * fy * src[row1 + x0] +
        fx * fy * src[row1 + x1];
      dst[y * dstW + x] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
  }
  return dst;
}

async function getMask(rgbaBuf: Buffer): Promise<{ rgb: Uint8Array; mask: Uint8Array; width: number; height: number }> {
  const { model, processor } = await getRmbg();
  const decoded = await sharp(rgbaBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(decoded.data);
  const width = decoded.info.width;
  const height = decoded.info.height;

  const rawImg = new RawImage(rgb, width, height, 3);
  const { pixel_values } = await processor(rawImg);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = await (model as any)({
    input: pixel_values,
    input_image: pixel_values,
    pixel_values,
  });
  const maskTensor = result["output_image"] ?? result["output"] ?? Object.values(result).find((v: unknown) => {
    const t = v as { data?: unknown; dims?: unknown };
    return t && t.data && t.dims;
  });
  if (!maskTensor) throw new Error(`No mask tensor. Keys: ${Object.keys(result).join(", ")}`);

  const dims = maskTensor.dims as number[];
  const modelH = dims[2];
  const modelW = dims[3];
  const logits = maskTensor.data as Float32Array;

  const modelMask = new Uint8Array(modelH * modelW);
  let isLogits = false;
  for (let i = 0; i < Math.min(logits.length, 256); i++) {
    if (logits[i] < -0.5 || logits[i] > 1.5) { isLogits = true; break; }
  }
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
  const mask = bilinearResize8(modelMask, modelW, modelH, width, height);
  return { rgb, mask, width, height };
}

function keepLargestComponent(mask: Uint8Array, width: number, height: number): Uint8Array {
  const N = width * height;
  const visited = new Uint8Array(N);
  const compLabel = new Int32Array(N);
  const queue = new Int32Array(N);
  let nextLabel = 1;
  let largestLabel = 0;
  let largestSize = 0;
  for (let seed = 0; seed < N; seed++) {
    if (visited[seed]) continue;
    if (mask[seed] <= CLEANUP_ALPHA_MIN) { visited[seed] = 1; continue; }
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
      const tryN = (n: number) => {
        if (!visited[n] && mask[n] > CLEANUP_ALPHA_MIN) {
          visited[n] = 1;
          queue[qTail++] = n;
        }
      };
      if (x > 0) tryN(i - 1);
      if (x < width - 1) tryN(i + 1);
      if (y > 0) tryN(i - width);
      if (y < height - 1) tryN(i + width);
    }
    if (size > largestSize) { largestSize = size; largestLabel = label; }
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = compLabel[i] === largestLabel ? mask[i] : 0;
  return out;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const horiz = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      let minV = 255;
      const xs = Math.max(0, x - radius);
      const xe = Math.min(width - 1, x + radius);
      for (let xx = xs; xx <= xe; xx++) { const v = mask[rowOff + xx]; if (v < minV) minV = v; }
      horiz[rowOff + x] = minV;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minV = 255;
      const ys = Math.max(0, y - radius);
      const ye = Math.min(height - 1, y + radius);
      for (let yy = ys; yy <= ye; yy++) { const v = horiz[yy * width + x]; if (v < minV) minV = v; }
      out[y * width + x] = minV;
    }
  }
  return out;
}

function computeBbox(mask: Uint8Array, width: number, height: number) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > BBOX_ALPHA_MIN) {
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

function applySoftboxGradient(rgb: Buffer, width: number, height: number, lightX: number, lightY: number, dimMult: number): Buffer {
  const maxD = Math.max(
    Math.hypot(lightX, lightY),
    Math.hypot(width - lightX, lightY),
    Math.hypot(lightX, height - lightY),
    Math.hypot(width - lightX, height - lightY),
  );
  const range = 1.0 - dimMult;
  const out = Buffer.alloc(rgb.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - lightX, y - lightY) / maxD;
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

async function postProcess(kieBuf: Buffer): Promise<Buffer> {
  const { rgb, mask: rawMask, width, height } = await getMask(kieBuf);
  const cleanedMask = keepLargestComponent(rawMask, width, height);
  const mask = erodeMask(cleanedMask, width, height, HALO_ERODE_PX);
  const bbox = computeBbox(mask, width, height);
  if (!bbox) throw new Error("no subject pixels after erode");
  const bboxW = bbox.x1 - bbox.x0 + 1;
  const bboxH = bbox.y1 - bbox.y0 + 1;

  const rgbaFull = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgbaFull[p * 4] = rgb[p * 3];
    rgbaFull[p * 4 + 1] = rgb[p * 3 + 1];
    rgbaFull[p * 4 + 2] = rgb[p * 3 + 2];
    rgbaFull[p * 4 + 3] = mask[p];
  }
  const croppedBuf = await sharp(rgbaFull, { raw: { width, height, channels: 4 } })
    .extract({ left: bbox.x0, top: bbox.y0, width: bboxW, height: bboxH })
    .png()
    .toBuffer();

  const maxW = CANVAS_SIZE * (1 - 2 * PADDING_RATIO);
  const maxH = CANVAS_SIZE * (1 - 2 * PADDING_RATIO);
  const scale = Math.min(maxW / bboxW, maxH / bboxH);
  const scaledW = Math.max(1, Math.round(bboxW * scale));
  const scaledH = Math.max(1, Math.round(bboxH * scale));
  const scaledCutout = await sharp(croppedBuf).resize(scaledW, scaledH, { kernel: "lanczos3" }).png().toBuffer();

  // Build the bg with gradient BAKED IN — same exact pixel values across every
  // run. The subject is composited on top afterwards UNCHANGED, so its kie
  // tones never blend with the gradient.
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

  const x = Math.round((CANVAS_SIZE - scaledW) / 2);
  const y = Math.round((CANVAS_SIZE - scaledH) / 2);
  return await sharp(bgRgb, { raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 3 } })
    .composite([{ input: scaledCutout, left: x, top: y }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function main() {
  const results: Array<{ label: string; rawKieUrl: string; finalUrl: string; finalBuf: Buffer }> = [];
  for (const t of TEST_CASES) {
    console.log(`\n=== ${t.label} ===`);
    const kieBuf = await callKie(t.sourceUrl);
    const rawKieUrl = await uploadToSupabase(kieBuf, `heroes-test/${t.label}-raw.png`, "image/png");
    console.log(`  raw kie hero: ${rawKieUrl}`);
    console.log(`  post-processing ...`);
    const finalBuf = await postProcess(kieBuf);
    const finalUrl = await uploadToSupabase(finalBuf, `heroes-test/${t.label}-final.jpg`, "image/jpeg");
    console.log(`  final hero:   ${finalUrl}`);
    results.push({ label: t.label, rawKieUrl, finalUrl, finalBuf });
  }

  // Build 2x2 grid composite of the 4 final heroes (tile size = CANVAS_SIZE / 2)
  if (results.length === 4) {
    const tile = Math.round(CANVAS_SIZE / 2);
    const tiles = await Promise.all(
      results.map((r) => sharp(r.finalBuf).resize(tile, tile, { kernel: "lanczos3" }).toBuffer()),
    );
    const gridBuf = await sharp({
      create: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: 3, background: TARGET_BG },
    })
      .composite([
        { input: tiles[0], left: 0, top: 0 },
        { input: tiles[1], left: tile, top: 0 },
        { input: tiles[2], left: 0, top: tile },
        { input: tiles[3], left: tile, top: tile },
      ])
      .jpeg({ quality: 92 })
      .toBuffer();
    const gridUrl = await uploadToSupabase(gridBuf, `heroes-test/grid-2x2.jpg`, "image/jpeg");
    console.log(`\nGrid (2x2, TL→TR→BL→BR order matches test cases): ${gridUrl}`);
  }

  console.log("\n========== REGRESSION TEST RESULTS ==========");
  for (const r of results) {
    console.log(`\n${r.label}`);
    console.log(`  raw kie:  ${r.rawKieUrl}`);
    console.log(`  final:    ${r.finalUrl}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
