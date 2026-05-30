/**
 * Lifestyle Scene Design — Claude-API scene authoring.
 *
 * Given a product URL or id, this script:
 *   1. downloads the product's gallery + per-variant reference images,
 *      resizing every one to a bounded JPEG (<= 1024px, ~1 MP);
 *   2. makes ONE isolated Claude API call — the design rule set as a cached
 *      system prompt, the product context + scene ledger + images as the user
 *      message — and gets six lifestyle scene prompts back as structured JSON;
 *   3. writes `scene-overrides/<productId>.json` (picked up verbatim by
 *      `scripts/_lifestyle-image-creator.ts`);
 *   4. appends the six new scenes to `scene-ledger.md`.
 *
 * This replaces the old flow where Claude Code viewed the images inside the
 * interactive conversation. Doing the analysis in a dedicated API call means
 * the images are resized right before the request and never accumulate in a
 * chat transcript — so the Claude vision API's per-image megapixel limit and
 * its stricter "many-image request" dimension limit are never tripped.
 *
 * Usage:
 *   npx tsx scripts/_lifestyle-scene-design.ts <productIdOrUrl> [--dry-run]
 *
 * --dry-run downloads + resizes the images and assembles the prompt, but does
 * not call the API or write the override — useful for inspecting the inputs.
 *
 * Auto-loads .env.local for ANTHROPIC_API_KEY + Supabase credentials.
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Env loader (copied from _lifestyle-scene-prep.ts — keeps that file untouched)
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const MODEL = "claude-opus-4-7";
const COUNT = 6;
/** Cap on gallery images sent to the model — first N by position are the
 *  representative shots; detail/packaging shots past this add little. */
const MAX_GALLERY = 14;
/** Per-image dimension cap. 1024px ≈ 1.05 MP, safely under the Claude vision
 *  API's ~1.15 MP per-image limit and far under the 2000px many-image limit. */
const IMG_CAP = 1024;

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
const ROOT = process.cwd();
const PREP_ROOT = path.resolve(ROOT, "scene-overrides", "_prep");
const OVERRIDE_ROOT = path.resolve(ROOT, "scene-overrides");
const PLAYBOOK_FILE = path.resolve(ROOT, "LIGHTING-LIFESTYLE-PLAYBOOK.md");
const LEDGER_FILE = path.resolve(ROOT, "scene-ledger.md");
const ACCENT_BANK_FILE = path.resolve(ROOT, "accent-bank.md");
const DAZUMA_FILE = path.resolve(
  ROOT,
  ".claude",
  "skills",
  "dazuma-aesthetic",
  "SKILL.md",
);

let _prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  return getSupabase().storage.from(BUCKET).getPublicUrl(storagePath).data
    .publicUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function detectProductId(input: string): string {
  const reviewMatch = input.match(/\/review\/([A-Za-z0-9_-]+)/);
  if (reviewMatch) return reviewMatch[1];
  if (/^c[a-z0-9]{24,}$/.test(input)) return input;
  console.error(
    `Could not detect productId from "${input}". Expected a cuid or /review/<id> URL.`,
  );
  process.exit(1);
}

function safeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 30);
}

/** Download an image and normalise it to a bounded JPEG. Returns the resized
 *  buffer (also written to `destNoExt`.jpg for inspection), or null on failure. */
async function downloadResized(
  url: string,
  destNoExt: string,
): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! download ${res.status} — ${url.slice(0, 70)}`);
      return null;
    }
    const raw = Buffer.from(await res.arrayBuffer());
    const out = await sharp(raw)
      .resize({
        width: IMG_CAP,
        height: IMG_CAP,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    fs.writeFileSync(`${destNoExt}.jpg`, out);
    return out;
  } catch (e) {
    console.warn(
      `  ! image failed — ${url.slice(0, 70)}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/** Crude HTML → text for the scraped description. */
function htmlToText(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Render the productContext JSON blob compactly (capped). */
function renderProductContext(raw: string | null): string {
  if (!raw) return "_(none)_";
  try {
    const text = JSON.stringify(JSON.parse(raw), null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n… (truncated)` : text;
  } catch {
    return raw.length > 2000 ? `${raw.slice(0, 2000)}… (truncated)` : raw;
  }
}

/** Read a reference file, stripping any leading YAML frontmatter block. */
function readReference(file: string): string {
  if (!fs.existsSync(file)) {
    console.warn(`  ! reference file missing — ${path.relative(ROOT, file)}`);
    return "";
  }
  let text = fs.readFileSync(file, "utf-8");
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(text.indexOf("\n", end + 1) + 1);
  }
  return text.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — the design rule set (stable across runs → cached)
// ─────────────────────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  const playbook = readReference(PLAYBOOK_FILE);
  const dazuma = readReference(DAZUMA_FILE);
  const accents = readReference(ACCENT_BANK_FILE);

  return `You are an interior- and exterior-lighting designer. Your job is to
look at one real lighting product — its gallery photos and its per-variant
reference images — and author six lifestyle / in-context scene prompts for an
AI image generator, reasoning like a designer about where the fixture belongs,
what surrounds it, and what palette suits it.

Work in this order:
1. VIEW every image you are given. The gallery shows the product and how it is
   really used; the variant reference images show the exact unit each scene
   must be paired with.
2. CLASSIFY the product as indoor, outdoor, or both — weigh IP/waterproof
   ratings in the specs first, then the imagery, then title keywords, then
   material. If variant images disagree, it is "both" and you split the six
   scenes accordingly.
3. DESIGN six scenes following the playbook below. Each of the six is a
   genuinely different room type, design style, wall colour and camera angle;
   no accent object repeats across the set; all are 1:1 framing.

Follow the DESIGN PLAYBOOK and DAZUMA STYLE BIBLE exactly. Pull accent objects
from the ACCENT BANK for variety. The SCENE LEDGER (supplied in the user
message) lists every scene already used — deliberately avoid repeating any
room type, design style, wall colour or camera angle from it.

Each scene's "prompt" field is a self-contained ~150-200 word text-to-image
prompt, scene-first, in three movements:
  (a) Scene & camera — room, lens, camera height/angle, framing (1:1), time of
      day, the other (non-fixture) light source, and 3-4 styling beats.
  (b) Short product lock — "matches the reference image exactly", the 1-2
      features most likely to drift, and the fixture's actual COLOUR-TEMPERATURE
      class chosen from the variant reference paired with that slot (see below).
  (c) Vibe closer — palette (3-5 colours), "sharp focus, natural and
      photographic, no people, no cinematic moodiness".

DERIVE THE FIXTURE'S LIGHT COLOUR PER-VARIANT, FROM EACH VARIANT REFERENCE
IMAGE, AND STATE IT EXPLICITLY. Image-to-image alone is not enough — Nano
Banana Pro will often default to a warm amber render unless the prompt tells
it otherwise. So look at each variant reference: examine the diffuser / LED
strip / bulb itself (NOT the bounce on the surrounding wall, which can be
tinted by the room colour) and classify its emission into ONE of:
  - "warm amber 2400-2700K"   — golden, candlelit, distinctly orange-yellow
  - "warm white 2700-3000K"   — soft warm white, slightly creamy
  - "soft white 3000-3500K"   — warm-leaning white, gentle
  - "neutral white 3500-4000K" — clean white, full-spectrum / "eye-care" LEDs
  - "cool white 4500-5000K"   — crisp, daylight-leaning, bright LED rings
Each scene's product lock writes the colour class of the variant paired with
that slot (per the slot→variant map). If all variants emit the same class,
all 6 scenes naturally agree; if they differ, the scenes differ accordingly.
Sanity priors — "全光谱" / "护眼" / "full-spectrum" / "eye-care" LEDs are almost
always neutral white (3500-4000K). Modern bright LED-strip ring chandeliers
("圆环") usually emit cool white (4500-5000K). A fixture with a colour-temp
selector ("3 in 1" / "三色光") shows ONE specific state in its reference image
— use that, don't guess.
Use RELATIVE scale ("head height of the chair"), never absolute cm/inches. Do
not add a heavy "PRODUCT FOCUS / no other lighting" directive — the product
lock plus hero language already cover prominence, and a layered second light
source is wanted.

NEVER include alcohol of any kind in any scene — no wine, whisky, beer,
cocktails, spirits, liqueur, decanters, wine glasses, or a bar cart staged with
bottles — even for a bar, speakeasy or lounge setting. Style those scenes with
coffee, tea, water, glassware that is clearly empty, or no drinkware at all.

Scene N must be designed for the variant shown in the slot-N reference image
(the user message gives the slot→variant table). Return scene N with
variantSlot = N, in order 1..6. Aim for a balanced mix of "minimalist" scenes
(low density, tight 25-35% framing) and "homey" scenes (mid density, wider
15-25% framing); set each scene's "mode" accordingly.

Return your answer through the required JSON schema only.

================================ DESIGN PLAYBOOK ================================
${playbook || "_(playbook file unavailable)_"}

============================== DAZUMA STYLE BIBLE ==============================
${dazuma || "_(dazuma style bible unavailable)_"}

================================= ACCENT BANK =================================
${accents || "_(accent bank unavailable)_"}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured-output schema
// ─────────────────────────────────────────────────────────────────────────────
const LIGHTING_CATEGORIES = [
  "table-lamp",
  "floor-lamp",
  "wall-sconce",
  "chandelier",
  "pendant",
  "flush-mount",
  "outdoor",
] as const;

const SCENE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: [...LIGHTING_CATEGORIES] },
    classification: {
      type: "string",
      enum: ["indoor", "outdoor", "both"],
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slug: { type: "string" },
          mode: { type: "string", enum: ["minimalist", "homey"] },
          variantSlot: { type: "integer" },
          prompt: { type: "string" },
          room: { type: "string" },
          designStyle: { type: "string" },
          wallColour: { type: "string" },
          cameraAngle: { type: "string" },
          timeOfDay: { type: "string" },
          accents: { type: "array", items: { type: "string" } },
        },
        required: [
          "slug",
          "mode",
          "variantSlot",
          "prompt",
          "room",
          "designStyle",
          "wallColour",
          "cameraAngle",
          "timeOfDay",
          "accents",
        ],
      },
    },
  },
  required: ["category", "classification", "scenes"],
} as const;

interface DesignedScene {
  slug: string;
  mode: "minimalist" | "homey";
  variantSlot: number;
  prompt: string;
  room: string;
  designStyle: string;
  wallColour: string;
  cameraAngle: string;
  timeOfDay: string;
  accents: string[];
}
interface DesignResult {
  category: (typeof LIGHTING_CATEGORIES)[number];
  classification: "indoor" | "outdoor" | "both";
  scenes: DesignedScene[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const lightIdx = args.indexOf("--light");
  const lightOverride =
    lightIdx !== -1 && args[lightIdx + 1] ? args[lightIdx + 1] : null;
  const input = args.find(
    (a, i) =>
      !a.startsWith("--") && (lightIdx === -1 || i !== lightIdx + 1),
  );
  if (!input) {
    console.error(
      'Usage: npx tsx scripts/_lifestyle-scene-design.ts <productIdOrUrl> [--dry-run] [--light "warm white 3000K"]',
    );
    process.exit(1);
  }
  if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set (.env.local)");
    process.exit(1);
  }

  const productId = detectProductId(input);
  const prisma = getPrisma();

  // Fetch the product, retrying transient pgbouncer connection blips.
  async function fetchProduct() {
    return prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isHidden: false }, orderBy: { position: "asc" } },
        images: true,
      },
    });
  }
  let product: Awaited<ReturnType<typeof fetchProduct>> = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      product = await fetchProduct();
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt === 6) {
        console.error(`DB fetch failed after 6 attempts: ${msg}`);
        process.exit(1);
      }
      console.warn(
        `  DB connection attempt ${attempt}/6 failed (transient) — retrying in 3s...`,
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!product) {
    console.error(`Product ${productId} not found`);
    process.exit(1);
  }

  console.log(`Lifestyle Scene Design — ${product.title.slice(0, 70)}`);

  // ── Prep folder — wiped each run so no stale oversized images linger ────
  const outDir = path.join(PREP_ROOT, productId);
  const galleryDir = path.join(outDir, "gallery");
  const variantsDir = path.join(outDir, "variants");
  fs.rmSync(galleryDir, { recursive: true, force: true });
  fs.rmSync(variantsDir, { recursive: true, force: true });
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.mkdirSync(variantsDir, { recursive: true });

  // ── Hero pool + 6 slots — mirrors _lifestyle-image-creator.ts so each
  //    scene is paired with the variant the creator will pair with it.
  const imagesById = new Map(product.images.map((img) => [img.id, img]));
  const seenPaths = new Set<string>();
  const heroPool: Array<{
    variantPosition: number;
    variantTitle: string;
    url: string;
  }> = [];
  for (const v of product.variants) {
    const img =
      (v.featuredImageId ? imagesById.get(v.featuredImageId) : undefined) ??
      product.images.find((pi) => pi.variantId === v.id) ??
      product.images[0];
    if (!img) continue;
    const key = img.storagePath || img.sourceUrl;
    if (seenPaths.has(key)) continue;
    seenPaths.add(key);
    heroPool.push({
      variantPosition: v.position,
      variantTitle: v.title,
      url: img.storagePath
        ? publicSupabaseUrlFromPath(img.storagePath)
        : img.sourceUrl,
    });
  }
  if (heroPool.length === 0) {
    console.error("No reference image found for any visible variant.");
    process.exit(1);
  }
  // slot i (1-based) → heroPool[(i-1) % heroPool.length]
  const slots = Array.from({ length: COUNT }).map((_, i) => {
    const ref = heroPool[i % heroPool.length];
    return {
      slot: i + 1,
      heroIndex: i % heroPool.length,
      variantPosition: ref.variantPosition,
      variantTitle: ref.variantTitle,
    };
  });

  // ── Download + resize the gallery ──────────────────────────────────────
  const sourceImages = product.images
    .filter((img) => img.imageType === "source" || img.imageType == null)
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_GALLERY);
  console.log(`Downloading ${sourceImages.length} gallery image(s)…`);
  const gallery: Array<{ label: string; b64: string }> = [];
  for (let i = 0; i < sourceImages.length; i++) {
    const img = sourceImages[i];
    const url = img.storagePath
      ? publicSupabaseUrlFromPath(img.storagePath)
      : img.sourceUrl;
    const nn = String(i + 1).padStart(2, "0");
    const buf = await downloadResized(
      url,
      path.join(galleryDir, `${nn}_${safeSlug(img.fileName ?? img.id)}`),
    );
    if (buf) gallery.push({ label: `Gallery image ${i + 1}`, b64: buf.toString("base64") });
  }

  // ── Download + resize the UNIQUE variant reference images ──────────────
  console.log(`Downloading ${heroPool.length} unique variant reference image(s)…`);
  const variantImages: Array<{ label: string; b64: string }> = [];
  for (let h = 0; h < heroPool.length; h++) {
    const ref = heroPool[h];
    const usedBy = slots.filter((s) => s.heroIndex === h).map((s) => s.slot);
    const buf = await downloadResized(
      ref.url,
      path.join(variantsDir, `hero${h + 1}_${safeSlug(ref.variantTitle)}`),
    );
    if (buf)
      variantImages.push({
        label: `Variant reference for scene slot(s) ${usedBy.join(", ")} — variant "${ref.variantTitle}"`,
        b64: buf.toString("base64"),
      });
  }
  if (variantImages.length === 0) {
    console.error("All variant reference images failed to download.");
    process.exit(1);
  }

  // ── Product context text ───────────────────────────────────────────────
  const slotTable = slots
    .map(
      (s) =>
        `| ${s.slot} | ${s.variantPosition} | ${s.variantTitle} |`,
    )
    .join("\n");
  const variantTable = product.variants
    .map((v) => {
      const opts = [v.option1, v.option2, v.option3]
        .map((o) => o ?? "—")
        .join(" | ");
      const labels = [v.supplierLabel1, v.supplierLabel2, v.supplierLabel3]
        .filter(Boolean)
        .join(" / ");
      return `| ${v.position} | ${v.title} | ${opts} | ${labels || "—"} |`;
    })
    .join("\n");

  const contextText = `# Product — ${product.title}

- Product ID: ${productId}
- Product type: ${product.productType ?? "—"}
- Option axes: ${product.optionNames ?? "—"}
- Visible variants: ${product.variants.length}
- Gallery images supplied: ${gallery.length}

## Slot → variant map
Design scene N for the variant shown in the slot-N reference image.

| Slot | Variant position | Variant title |
|------|------------------|---------------|
${slotTable}

## Variants
| Pos | Title | Option 1 \\| 2 \\| 3 | Supplier labels |
|-----|-------|---------------------|-----------------|
${variantTable}

## Description
${htmlToText(product.descriptionHtml) || "_(none)_"}

## Product context / specs
\`\`\`json
${renderProductContext(product.productContext)}
\`\`\``;

  const ledger = fs.existsSync(LEDGER_FILE)
    ? fs.readFileSync(LEDGER_FILE, "utf-8")
    : "_(no ledger)_";

  const systemPrompt = buildSystemPrompt();

  // ── Assemble the user message — text, then every image with a label ────
  type Block =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: "image/jpeg"; data: string };
      };
  const content: Block[] = [
    { type: "text", text: contextText },
    {
      type: "text",
      text: `## Scene ledger — avoid repeating anything below\n\n${ledger}`,
    },
  ];
  if (lightOverride) {
    content.push({
      type: "text",
      text: `## Light colour-temp override\n\nThe user has explicitly specified the fixture's emitted light as: **"${lightOverride}"**. Use this exact phrasing in every scene's product lock — do NOT derive a different colour from the gallery imagery.`,
    });
  }
  content.push({
    type: "text",
    text: `Below are the product gallery images (${gallery.length}) followed by the unique per-variant reference images (${variantImages.length}). View all of them, then design the six scenes.`,
  });
  for (const g of [...gallery, ...variantImages]) {
    content.push({ type: "text", text: g.label });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: g.b64 },
    });
  }

  console.log(
    `Prepared ${gallery.length} gallery + ${variantImages.length} variant image(s); system prompt ${systemPrompt.length} chars.`,
  );

  if (dryRun) {
    console.log("\n--dry-run — skipping API call and override write.");
    console.log(`Prep artifacts: ${path.relative(ROOT, outDir)}`);
    await prisma.$disconnect();
    return;
  }

  // ── Claude API — one isolated, structured-output call ──────────────────
  console.log(`Calling ${MODEL} to design 6 scenes…`);
  const anthropic = new Anthropic();
  let result: DesignResult;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: SCENE_SCHEMA },
      },
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content }],
    } as Anthropic.MessageCreateParams);

    if (response.stop_reason === "refusal") {
      console.error("Model refused the request. Aborting.");
      process.exit(1);
    }
    if (response.stop_reason === "max_tokens") {
      console.error("Model hit max_tokens before finishing. Aborting.");
      process.exit(1);
    }
    const textBlock = [...response.content]
      .reverse()
      .find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) {
      console.error("No text block in the model response. Aborting.");
      process.exit(1);
    }
    result = JSON.parse(textBlock.text) as DesignResult;
    const u = response.usage;
    console.log(
      `  usage: in ${u.input_tokens} (cache read ${u.cache_read_input_tokens ?? 0}), out ${u.output_tokens}`,
    );
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${e.status}: ${e.message}`);
    } else {
      console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    }
    process.exit(1);
  }

  if (!Array.isArray(result.scenes) || result.scenes.length === 0) {
    console.error("Model returned no scenes. Aborting.");
    process.exit(1);
  }
  if (result.scenes.length !== COUNT) {
    console.warn(
      `  ! model returned ${result.scenes.length} scenes (expected ${COUNT}) — writing what it returned.`,
    );
  }

  // ── Write the override ─────────────────────────────────────────────────
  const override = {
    productId,
    productTitle: product.title,
    authoredBy: "lifestyle-scene-design.ts",
    authoredAt: new Date().toISOString(),
    classification: result.classification,
    category: result.category,
    scenes: result.scenes.map((s, i) => ({
      slug: (s.slug && s.slug.trim()) || `scene-${i + 1}`,
      mode: s.mode === "homey" ? "homey" : "minimalist",
      prompt: s.prompt,
      variantSlot:
        typeof s.variantSlot === "number" &&
        s.variantSlot >= 1 &&
        s.variantSlot <= COUNT
          ? s.variantSlot
          : i + 1,
      room: s.room,
      designStyle: s.designStyle,
      wallColour: s.wallColour,
      cameraAngle: s.cameraAngle,
      timeOfDay: s.timeOfDay,
      accents: s.accents,
    })),
  };
  fs.mkdirSync(OVERRIDE_ROOT, { recursive: true });
  const overrideFile = path.join(OVERRIDE_ROOT, `${productId}.json`);
  fs.writeFileSync(overrideFile, JSON.stringify(override, null, 2));
  console.log(`Wrote ${path.relative(ROOT, overrideFile)}`);

  // ── Append to the scene ledger ─────────────────────────────────────────
  const rows = override.scenes
    .map(
      (s, i) =>
        `| ${i + 1} | ${s.room} | ${s.designStyle} | ${s.wallColour} | ${s.cameraAngle} | ${s.timeOfDay} | ${(s.accents ?? []).join(", ")} |`,
    )
    .join("\n");
  const ledgerEntry = `

## ${product.title} (\`${productId}\`)

Classified: ${result.classification} · category: ${result.category} · authored ${override.authoredAt.slice(0, 10)}

| # | Room | Design style | Wall colour | Camera angle | Time of day | Key accents |
|---|------|--------------|-------------|--------------|-------------|-------------|
${rows}
`;
  fs.appendFileSync(LEDGER_FILE, ledgerEntry);
  console.log(`Appended 6 scenes to ${path.relative(ROOT, LEDGER_FILE)}`);

  console.log("");
  console.log(`Done. Next: npx tsx scripts/_lifestyle-image-creator.ts ${productId} --headed`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  try {
    await getPrisma().$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
