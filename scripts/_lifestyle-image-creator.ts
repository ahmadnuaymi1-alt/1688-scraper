/**
 * Lifestyle Image Creator — Mode A (local DB) only for v1.
 *
 * Generates 6 lifestyle photographs per product using kie.ai's Nano Banana
 * Pro (Gemini 3 Pro Image). Each image:
 *   - 1:1 aspect ratio at 2K
 *   - Different camera angle (6 baked angle directives)
 *   - Uses a DIFFERENT hero image as reference where possible (cycles)
 *   - Either single-unit or multi-unit (same variant repeated N times),
 *     per the --multi-unit flag
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl>
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --multi-unit 3
 *   npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> --dry-run
 *
 * Auto-loads .env.local so no special flag is needed.
 *
 * See .claude/skills/lifestyle-image-creator/SKILL.md for full spec.
 */

import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { PrismaClient } from "@prisma/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Env loader (mirrors _hero-image-creator.ts)
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
// kie.ai's identifier for Google's Gemini 3 Pro Image (Nano Banana Pro).
// Verified against legacy gen-858-full-pipeline-kie.ts.
const KIE_MODEL = process.env.LIFESTYLE_KIE_MODEL || "nano-banana-pro";
const KIE_POLL_INTERVAL_MS = 5_000;
const KIE_TIMEOUT_MS = 8 * 60 * 1000; // Nano Banana Pro can take 5-8 min at 2K
const COUNT = 6;
const RESOLUTION = process.env.LIFESTYLE_RESOLUTION || "1K"; // 1K default, 2K opt-in
// Pricing tier on kie.ai: ~$0.04 at 1K, $0.09 at 2K (user-confirmed).
const COST_PER_IMAGE_USD = RESOLUTION === "2K" ? 0.09 : 0.04;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";

// User-provided master prompt (verbatim). Edit here to change the master rules.
const LIFESTYLE_PROMPT = `ABSOLUTE REQUIREMENT — PRODUCT MUST BE THE EXACT REFERENCE PRODUCT:
The reference image(s) show the EXACT product that MUST appear in the output. Replicate every visual detail: shape, proportions, color, materials, finish, hardware, and surface texture. Do NOT invent a different product. Do NOT change the silhouette. The product in the output must be visually identical to the reference image — the same physical object. Use the provided hero images as the absolute truth for the product's appearance.

FUNCTION FIDELITY: Depict the product's actual operating mechanism or physical reality. Do not invent behaviors, movements, or functions the actual product cannot produce.

COLOR & SILHOUETTE FIDELITY: The product's color, finish, and material must EXACTLY match the reference image. The output's surface treatment must be visually identical to the reference. Every component visible in the reference must appear in the output. Do NOT substitute a "similar-looking" product from your training data.

BORDERS / FRAMES: NEVER add a decorative border, frame, outline, mounting plate, backplate, or trim around the product silhouette that isn't visible in the reference image.

OUTPUT FORMAT — ONE SINGLE PHOTOGRAPH:
This prompt produces ONE image: a single photograph of a single scene. Do NOT produce a collage, a grid, a split, a triptych, a composite, a mood board, a side-by-side comparison, or any image that contains multiple scenes / multiple framings. The output is a single rectangular photograph (1:1 aspect ratio) as if shot once with one camera in one moment.

NO CAMERA UI / NO PHONE OVERLAY:
Do NOT render any camera-app interface elements inside the image. NO shutter button, NO capture button, NO settings cog, NO viewfinder corner brackets, NO live-preview indicator, NO phone status bar, NO app chrome. The image IS the photograph itself, edge-to-edge.

SCENE & VIBE (Conditional Lighting Requirement):
Mid-to-high-end home of someone with great taste. The setting must make the product look DESIRABLE and fit the product's actual best use case naturally. The mood of the scene is determined by the product's intended operation:
- **For functional lighting products (like lamps or task lights):** The product MUST be actively powered and illuminating the scene according to its design (e.g., a warm pool of light on a desk). The ambiance must clearly show the light source is operational.

Pick the specific architecture and home that fits the mood. American homes only (per US_MARKET_RULE).

PRODUCT IN USE:
The product is shown in its natural context, being used or placed appropriately for its intended function. It should look like it belongs in the space, not just as a styled-only display piece.

FOCAL POINT:
Compose around the product naturally within the environment. Earn the focal point through the composition, not just through dead-center placement.

IPHONE 16 PRO MAX SHOT:
Casual photo snapped on iPhone 16 Pro Max main 48MP wide camera (24mm equivalent, f/1.78). Apple Smart HDR 5: mild HDR, slightly cool-neutral color science (no warm cast, no teal-orange grade), sharp focal area with organic corner softness, handheld feel (slight tilt — NOT perfectly leveled), visible micro-grain, realistic depth. Looks like a real iPhone photo a normal person posts to a group chat — phone-snap aesthetic, not a highly produced studio shoot.

STRICT ANTI-AI REALISM (Clean realism — never dirty):
- Reject the cinematic AI 'balanced' aesthetic — show real-world thoughtfully-arranged composition.
- No CGI/3D render look, no plastic-skin people, no over-symmetric composition.
- Photographic texture: real material character only (paper grain, fabric weave, wall paint texture).
- Composition slightly off, like real handheld shots.
- The room is CLEAN and CARED-FOR. Mid-tier and luxury both fine; cleanliness is the constant.

CLEANLINESS GATE:
Every surface in the scene must read as clean and cared-for. NO grime rings, NO yellowing plastics, NO water stains, NO peeling paint, NO deep scratches, NO worn paths. Natural material textures (like wood grain) are fine, but visible damage or neglect is forbidden. "Lived-in" means asymmetric and thoughtfully-arranged — NOT dirty, scratched, worn, or grimy.

US MARKET RULE:
This product is sold to US customers, so the scene must read as a US home:
- ZERO Mandarin / Chinese characters / Asian script anywhere in the frame.
- Any visible text must be in ENGLISH only — or use abstract / illegible text that doesn't read as any specific language.
- Architecture, furniture, and decor archetypes should read as American homes. Western interior design vocabulary only.
- Outlets (if visible) are US-style (NEMA 5-15, two flat vertical slots + ground hole)`;

// 6 distinct camera angles. Order = output slot 1..6.
const ANGLE_DIRECTIVES: Array<{ slug: string; directive: string }> = [
  {
    slug: "eye-level-wide",
    directive:
      "Eye-level wide establishing shot. The product sits in its natural use environment (room, desk, table) — the camera is far enough back to show the room context around it. Composition: rule-of-thirds, product off-center but clearly the subject.",
  },
  {
    slug: "low-three-quarter",
    directive:
      "Low angle three-quarter view from the front-side. Camera is roughly at the height of the product's base, looking slightly up at it. Foreground surface (the table/desk the product sits on) is visible with shallow depth of field falling off behind.",
  },
  {
    slug: "top-down-flat-lay",
    directive:
      "Top-down flat-lay perspective. Camera directly overhead. Product centered or slightly off-center, surrounded by a few aspirational adjacent objects (e.g. an open hardcover book, a small ceramic vessel, a folded linen throw, a brass tray, eyeglasses). NOT a sterile studio flat-lay — a real home tabletop.",
  },
  {
    slug: "over-the-shoulder",
    directive:
      "Casual over-the-shoulder shot. The viewer's hand or forearm is partially visible in the foreground (lower corner), as if they just walked up to the product or are about to interact with it. The product is the focal point in the middle distance.",
  },
  {
    slug: "ambient-room",
    directive:
      "Ambient room shot from across the space. The product is visible as part of a thoughtful vignette — not center frame — but the composition and ambient light naturally lead the eye toward it. Show enough room context to communicate the home's character.",
  },
  {
    slug: "close-up-detail",
    directive:
      "Close-up detail shot focused on the product's hero feature (e.g. for a lamp: the lit shade and visible bulb glow; for a clock: the illuminated face and hands; for textiles: the primary weave; for ceramics: the glaze edge). Background falls off gently in shallow DOF.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────
interface Args {
  input: string;
  multiUnit: number | null; // null = single-unit
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: npx tsx scripts/_lifestyle-image-creator.ts <productIdOrUrl> [--multi-unit N] [--dry-run]",
    );
    process.exit(1);
  }
  let input = "";
  let multiUnit: number | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--multi-unit") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) {
        multiUnit = parseInt(next, 10);
        i++;
      } else {
        multiUnit = 3; // default count if no explicit number
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (!input) {
      input = a;
    }
  }
  if (!input) {
    console.error("Missing <input> argument.");
    process.exit(1);
  }
  return { input, multiUnit, dryRun };
}

function detectProductId(input: string): string {
  const reviewMatch = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (reviewMatch) return reviewMatch[1];
  if (/^c[a-z0-9]{24,}$/.test(input)) return input;
  console.error(
    `Could not detect productId from "${input}". Expected a cuid or /review/<id> URL.`,
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
    state?: string;
    failCode?: string;
    failMsg?: string;
    resultJson?: string;
  };
}

async function kieCreateTask(prompt: string, imageUrl: string): Promise<string> {
  const token = process.env.KIE_API_KEY;
  if (!token) throw new Error("KIE_API_KEY not set");
  const res = await fetch(KIE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: KIE_MODEL,
      input: {
        prompt,
        // Nano Banana Pro on kie.ai uses `image_input` (plural array, snake_case)
        // — NOT `image_urls` like Seedream. Verified against legacy script.
        image_input: [imageUrl],
        aspect_ratio: "1:1",
        resolution: RESOLUTION,
        output_format: "png",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`kie createTask HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as KieCreateResp;
  if (!json.data?.taskId) {
    throw new Error(
      `kie createTask returned no taskId: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return json.data.taskId;
}

async function kiePoll(taskId: string): Promise<Buffer> {
  const token = process.env.KIE_API_KEY!;
  const start = Date.now();
  while (Date.now() - start < KIE_TIMEOUT_MS) {
    const res = await fetch(
      `${KIE_POLL_ENDPOINT}?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
      continue;
    }
    const json = (await res.json()) as KiePollResp;
    const state = json.data?.state;
    if (state === "success") {
      const resultJsonRaw = json.data?.resultJson;
      if (!resultJsonRaw) throw new Error("kie: success but no resultJson");
      const parsed = JSON.parse(resultJsonRaw) as { resultUrls?: string[] };
      const urls = parsed.resultUrls ?? [];
      if (urls.length === 0) throw new Error("kie: resultUrls empty");
      const imgRes = await fetch(urls[0]);
      if (!imgRes.ok) throw new Error(`kie download HTTP ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    if (state === "fail") {
      throw new Error(
        `kie task failed: ${json.data?.failMsg || json.data?.failCode || "unknown"}`,
      );
    }
    await new Promise((r) => setTimeout(r, KIE_POLL_INTERVAL_MS));
  }
  throw new Error(`kie poll timeout after ${KIE_TIMEOUT_MS / 1000}s`);
}

async function kieRunLifestyle(prompt: string, imageUrl: string): Promise<Buffer> {
  try {
    const taskId = await kieCreateTask(prompt, imageUrl);
    return await kiePoll(taskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP 5\d\d/.test(msg)) {
      await new Promise((r) => setTimeout(r, 15_000));
      const taskId = await kieCreateTask(prompt, imageUrl);
      return await kiePoll(taskId);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────────────────
function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────
function buildPrompt(angleDirective: string, multiUnit: number | null): string {
  const unitClause = multiUnit
    ? `Show ${multiUnit} identical units of this product (the SAME variant in every copy — never mix different variants in one frame) placed naturally in the scene. Each unit's silhouette, color, finish, and proportions must match the reference image exactly.`
    : `Show ONE unit of this product in the scene. Do NOT render multiple copies.`;
  return `${LIFESTYLE_PROMPT}\n\nCAMERA ANGLE FOR THIS IMAGE:\n${angleDirective}\n\nUNIT COUNT FOR THIS IMAGE:\n${unitClause}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { input, multiUnit, dryRun } = parseArgs();
  const productId = detectProductId(input);

  const prisma = getPrisma();
  const product = await prisma.product.findUnique({
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

  console.log(`Lifestyle Image Creator — ${product.title.slice(0, 60)}`);
  console.log(
    `Mode: ${multiUnit ? `multi-unit (${multiUnit} per image)` : "single-unit"}${
      dryRun ? " — DRY RUN (no kie calls)" : ""
    }`,
  );

  // Collect unique hero files across visible variants. Prefer rows with
  // imageType="hero"; fall back to any variant-linked image if no hero exists
  // for a particular variant.
  const imagesById = new Map(product.images.map((img) => [img.id, img]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{
    variantId: string;
    storagePath: string;
    sourceUrl: string;
  }> = [];
  for (const v of product.variants) {
    if (!v.featuredImageId) continue;
    const img = imagesById.get(v.featuredImageId);
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    heroPool.push({
      variantId: v.id,
      storagePath: img.storagePath || "",
      sourceUrl: img.storagePath
        ? publicSupabaseUrlFromPath(img.storagePath)
        : img.sourceUrl,
    });
  }
  if (heroPool.length === 0) {
    console.error(
      "No hero images found on this product. Run /hero-image-creator first.",
    );
    process.exit(1);
  }
  console.log(`Unique hero pool: ${heroPool.length} image(s) — will cycle.`);

  const maxPosRow = await prisma.productImage.aggregate({
    where: { productId },
    _max: { position: true },
  });
  let nextPosition = (maxPosRow._max.position ?? 0) + 1;

  // Idempotency: load existing lifestyle rows for this product by their
  // storagePath. Skip slots whose target storagePath already exists so re-runs
  // only fill in failed/missing slots.
  const existingLifestyles = await prisma.productImage.findMany({
    where: { productId, imageType: "lifestyle" },
    select: { storagePath: true },
  });
  const existingPaths = new Set(
    existingLifestyles.map((r) => r.storagePath).filter((p): p is string => !!p),
  );
  if (existingPaths.size > 0) {
    console.log(`Idempotent skip: ${existingPaths.size} slot(s) already have lifestyle rows.`);
  }

  const t0 = Date.now();
  let okCount = 0;
  let failCount = 0;
  let skipExistingCount = 0;

  // Build the list of slots that actually need work. Reserve positions
  // up-front so parallel tasks don't race on `nextPosition`.
  type Slot = {
    i: number;
    angle: (typeof ANGLE_DIRECTIVES)[number];
    hero: (typeof heroPool)[number];
    prompt: string;
    storagePath: string;
    position: number;
  };
  const slotsToRun: Slot[] = [];
  for (let i = 0; i < COUNT; i++) {
    const angle = ANGLE_DIRECTIVES[i];
    const hero = heroPool[i % heroPool.length];
    const prompt = buildPrompt(angle.directive, multiUnit);
    const storagePath = `lifestyle/${productId}/${i + 1}-${angle.slug}.png`;
    if (existingPaths.has(storagePath)) {
      console.log(`  [${i + 1}/${COUNT}] ${angle.slug.padEnd(18)} ... SKIP (already exists)`);
      skipExistingCount++;
      continue;
    }
    if (dryRun) {
      console.log(`\n─── Slot ${i + 1} (${angle.slug}) ───`);
      console.log(`Reference hero: ${hero.sourceUrl.slice(0, 80)}`);
      console.log(`Prompt preview:\n${prompt.slice(0, 400)}…`);
      okCount++;
      continue;
    }
    slotsToRun.push({
      i,
      angle,
      hero,
      prompt,
      storagePath,
      position: nextPosition++,
    });
  }

  if (slotsToRun.length > 0) {
    console.log(
      `Running ${slotsToRun.length} slot(s) in parallel at ${RESOLUTION}...`,
    );
  }

  async function processSlot(slot: Slot): Promise<boolean> {
    const slotStart = Date.now();
    try {
      const buf = await kieRunLifestyle(slot.prompt, slot.hero.sourceUrl);
      const publicUrl = await uploadToSupabase(buf, slot.storagePath);
      await prisma.productImage.create({
        data: {
          productId,
          variantId: null,
          sourceUrl: publicUrl,
          storagePath: slot.storagePath,
          fileName: `${slot.i + 1}-${slot.angle.slug}.png`,
          altText: `Lifestyle ${slot.i + 1} — ${slot.angle.directive.slice(0, 80)}`,
          position: slot.position,
          downloadStatus: "downloaded",
          imageType: "lifestyle",
        },
      });
      const elapsed = ((Date.now() - slotStart) / 1000).toFixed(1);
      console.log(`  [${slot.i + 1}/${COUNT}] ${slot.angle.slug.padEnd(18)} ... OK (${elapsed}s)`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - slotStart) / 1000).toFixed(1);
      console.log(`  [${slot.i + 1}/${COUNT}] ${slot.angle.slug.padEnd(18)} ... FAIL (${elapsed}s) — ${msg.slice(0, 120)}`);
      return false;
    }
  }

  const settled = await Promise.allSettled(slotsToRun.map(processSlot));
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) {
      okCount++;
    } else {
      failCount++;
    }
  }

  const total = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = (okCount * COST_PER_IMAGE_USD).toFixed(2);
  console.log("");
  console.log(
    `Generated: ${okCount}/${COUNT}  Skipped (already exist): ${skipExistingCount}  Failed: ${failCount}  Wall time: ${total}s${
      dryRun ? " (dry run, no cost)" : `  Cost: ~$${cost}`
    }`,
  );
  console.log(`Review: /review/${productId}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  if (_prisma) await _prisma.$disconnect();
  process.exit(1);
});
