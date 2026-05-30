/**
 * Description Enrichment Service.
 *
 * 1688 product descriptions are dense with information embedded as TEXT INSIDE
 * IMAGES (Chinese specifications, feature callouts, sizing diagrams). The HTML
 * cleaner alone misses all of that. This service:
 *
 *   1. Pulls every <img> URL from the descriptionHtml
 *   2. Optionally pre-filters those URLs down to images that actually contain
 *      text overlays worth OCRing (one cheap batched vision call)
 *   3. Runs each survivor through Claude Haiku 4.5 vision to extract Chinese
 *      text + translate to English (parallelism cap of 3, image cap of 20)
 *   4. Concatenates the extracted text into a corpus
 *   5. Runs ONE structuring call (Claude Haiku 4.5 JSON) to organize the corpus
 *      into specs / callouts / marketing angles
 *   6. Runs ONE description-generation call (Claude Haiku 4.5) to turn that
 *      structured data into Shopify-ready HTML
 *
 * All AI calls go through Claude — no Gemini, no OpenAI.
 *
 * Unlike the legacy version which read/wrote the DB, this fn takes a
 * `ScrapedProduct` and returns the new `descriptionHtml` + `ProductContext`
 * so the caller can decide whether to persist.
 */

import sharp from "sharp";
import { z } from "zod";
import {
  claudeJSON,
  claudeText,
  claudeVision,
  getClaudeClient,
  isClaudeConfigured,
} from "@/lib/ai/claude-client";
import { prisma } from "@/lib/db";
import type { ProductContext, ScrapedProduct } from "@/types/product";

const MAX_IMAGES_PER_SCRAPE = 20;
const PARALLEL_OCR_CALLS = 3;
const PARALLEL_PREFILTER_DOWNLOADS = 6;
const PREFILTER_IMAGE_PX = 384;
const MODEL = "claude-haiku-4-5";

const SWATCH_OCR_CAP = 10;

const SWATCH_DIM_PROMPT = `Look at this product swatch image. Look ONLY for dimension annotations: text labels with measurement units (cm, mm, inch, in, ") next to arrows, brackets, or a labelled diagram. Examples of what counts: "28.5cm", "Width 15cm", "L 30 × W 20 × H 15", "直径 12cm", "高 40cm 宽 15cm".

If you find dimension annotations, output ONE LINE in this exact format:
DIMS: <value>

Where <value> is the dimension string normalized to US units in inches using the canonical W×H×D format with letter suffixes:
- 3D objects: "<W>"W × <H>"H × <D>"D" (e.g. 9.4"W × 9.4"H × 2.4"D)
- 2D flat objects: "<W>"W × <H>"H"
- Round / circular objects: "<W>"W × <H>"H" where W is the diameter and H is the thickness. NEVER write "Diameter" — always collapse it to W.
Translate Chinese units (厘米 = cm, 毫米 = mm). If the source labels are in cm, convert to inches by multiplying by 0.394 and rounding to 1 decimal (e.g. 28.5 cm → 11.2"). If the source labels are in mm, multiply by 0.0394 and round to 1 decimal. Don't make up missing values.

If the image has NO dimension annotations (just a clean product photo, a logo, or text without measurements), output exactly:
NONE

Output the DIMS or NONE line and nothing else. No preamble, no markdown, no explanation.`;

type LogFn = (level: "info" | "warn" | "error", message: string) => void | Promise<void>;

const noopLog: LogFn = () => {};

/**
 * Pull every <img src="..."> URL from an HTML string.
 * Deduplicates and filters out obviously-junk URLs (data: URIs, etc.).
 */
function extractImageUrls(html: string): string[] {
  if (!html) return [];
  const urls = new Set<string>();
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const u = m[1];
    if (!/^https?:\/\//.test(u)) continue;
    urls.add(u);
  }
  return Array.from(urls);
}

const OCR_PROMPT = `This is a Chinese 1688 product description image. It often contains GRIDS, TABLES, or LABELED DIAGRAMS with many data cells (model labels, dimensions, units, height ranges, feature callouts).

EXHAUSTIVELY extract EVERY VISIBLE PIECE OF TEXT — every label, every number, every unit, every section heading, every measurement. Do NOT summarize. Do NOT skip cells that look duplicated. Do NOT collapse a grid into prose.

Format your output as ONE PIECE OF INFO PER LINE. Preserve grid/table structure where possible (e.g. "A款 | width 15cm | height 40.5cm"). Translate Chinese alongside English in parentheses.

If the image has sections (e.g. retractable vs non-retractable), label each section clearly.

If there are diagrams with measurement arrows + numbers (e.g. a lamp with height/width labels), extract every number with its associated dimension.

Be thorough — missing details from this image lose product information downstream. If the image truly has no visible text, say so explicitly.`;

const PREFILTER_PROMPT = `You see N images numbered 1 through N. For each image, output ONE LINE in format \`<index>: YES\` or \`<index>: NO\`.

YES = the image contains deliberate visible TEXT OVERLAYS — dimension labels with cm/mm numbers, spec callouts, model labels (e.g. A款, B款, Model A), feature text, marketing copy text, Chinese/English descriptive text deliberately placed on the image. These are worth OCRing for product data.

NO = the image is a clean lifestyle/product photo with no text overlays. Accidental incidental text (book spines, calendar numbers, brand logos on background props) does NOT count as YES — only deliberate text-on-image counts.

BE CONSERVATIVE — if you see any deliberate text overlay, answer YES. If you're unsure, answer YES (we'd rather pay to OCR an empty image than miss text).

Output exactly N lines. No preamble, no explanation, no markdown fences.`;

/**
 * Send one image to Claude Haiku 4.5 vision. Returns empty string on failure
 * (caller skips that image).
 */
async function ocrSingleImage(imageUrl: string): Promise<string> {
  try {
    const text = await claudeVision({
      model: MODEL,
      imageUrl,
      prompt: OCR_PROMPT,
      maxTokens: 2048,
    });
    return text;
  } catch {
    return "";
  }
}

/**
 * Send one swatch image to Claude Haiku 4.5 vision with a dimension-only prompt.
 * Returns the normalized dimension string on a hit, null on miss/error. Used
 * as the last-resort tier (#4) in the dimension-extraction fallback chain —
 * only fires when no structured specs and no description-OCR row mentioned dims.
 */
async function ocrSwatchForDimensions(imageUrl: string): Promise<string | null> {
  try {
    const text = await claudeVision({
      model: MODEL,
      imageUrl,
      prompt: SWATCH_DIM_PROMPT,
      maxTokens: 64,
    });
    const line = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
    if (/^NONE\b/i.test(line)) return null;
    const m = line.match(/^DIMS:\s*(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * Worker-pool variant of Promise.all with bounded concurrency.
 */
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Pre-filter: batched low-res YES/NO check that drops images with no deliberate
 * text overlays. Fails open — any error returns the original URL list.
 */
async function filterImagesWithText(urls: string[], log: LogFn): Promise<string[]> {
  if (urls.length === 0) return urls;

  // 1) Download + resize each image to 384px JPEG
  const downloads = await parallelWithLimit(
    urls,
    PARALLEL_PREFILTER_DOWNLOADS,
    async (url): Promise<{ url: string; b64: string | null }> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return { url, b64: null };
        const buf = Buffer.from(await res.arrayBuffer());
        const resized = await sharp(buf)
          .resize(PREFILTER_IMAGE_PX, PREFILTER_IMAGE_PX, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 75 })
          .toBuffer();
        return { url, b64: resized.toString("base64") };
      } catch {
        return { url, b64: null };
      }
    },
  );

  const failedIdxs = downloads.flatMap((d, i) => (d.b64 == null ? [i] : []));
  const readyIdxs = downloads.flatMap((d, i) => (d.b64 != null ? [i] : []));
  if (readyIdxs.length === 0) {
    await log(
      "warn",
      `[desc-enrichment] Pre-filter: all ${urls.length} image downloads failed — falling back to OCR-all`,
    );
    return urls;
  }
  if (failedIdxs.length > 0) {
    await log(
      "info",
      `[desc-enrichment] Pre-filter: ${failedIdxs.length}/${urls.length} downloads failed — those will be OCR'd unconditionally`,
    );
  }

  // 2) Build the batched user content: image blocks + final instruction
  type ContentItem =
    | { type: "text"; text: string }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
          data: string;
        };
      };
  const content: ContentItem[] = [];
  for (let i = 0; i < readyIdxs.length; i++) {
    const d = downloads[readyIdxs[i]];
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: d.b64! },
    });
  }
  content.push({
    type: "text",
    text: PREFILTER_PROMPT.replace(/\bN\b/g, String(readyIdxs.length)),
  });

  // 3) Call Claude using the SDK directly — the shared `claudeVision` helper
  //    only supports one image; this pre-filter batches N images per call.
  let raw: string;
  try {
    const client = getClaudeClient();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });
    raw = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
  } catch (err) {
    await log(
      "warn",
      `[desc-enrichment] Pre-filter exception: ${err instanceof Error ? err.message : err} — falling back to OCR-all`,
    );
    return urls;
  }

  // 4) Parse "1: YES" / "2: NO" lines
  const parsed = new Map<number, boolean>();
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^(\d+)\s*[:\-]\s*(YES|NO)\b/i);
    if (m) parsed.set(parseInt(m[1], 10), m[2].toUpperCase() === "YES");
  }
  if (parsed.size < readyIdxs.length) {
    await log(
      "warn",
      `[desc-enrichment] Pre-filter parsed only ${parsed.size}/${readyIdxs.length} lines — falling back to OCR-all. Raw: ${raw.slice(0, 300)}`,
    );
    return urls;
  }
  const yesCompactIdxs = new Set(
    Array.from(parsed.entries())
      .filter(([, v]) => v)
      .map(([k]) => k - 1),
  );
  if (yesCompactIdxs.size === 0) {
    await log(
      "warn",
      `[desc-enrichment] Pre-filter marked all images NO — suspicious, falling back to OCR-all`,
    );
    return urls;
  }

  // 5) Union failed downloads with kept YES results
  const keptOriginalIdxs = new Set<number>(failedIdxs);
  for (const compactIdx of yesCompactIdxs) {
    keptOriginalIdxs.add(readyIdxs[compactIdx]);
  }
  const kept = urls.filter((_, i) => keptOriginalIdxs.has(i));
  await log(
    "info",
    `[desc-enrichment] Pre-filter: kept ${kept.length}/${urls.length} images (skipped ${urls.length - kept.length} text-less)`,
  );
  return kept;
}

const StructuredCorpusSchema = z.object({
  extractedSpecs: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .default([]),
  featureCallouts: z.array(z.string()).default([]),
  marketingAngles: z.array(z.string()).default([]),
});

/**
 * Send the full extracted-text corpus to Claude Haiku 4.5 with a JSON schema
 * for structured extraction.
 */
async function structureCorpus(
  productTitle: string,
  corpus: string,
  log: LogFn,
): Promise<{
  extractedSpecs: Array<{ name: string; value: string }>;
  featureCallouts: string[];
  marketingAngles: string[];
}> {
  const systemPrompt = `You convert a noisy OCR corpus into a COMPLETE structured JSON summary. Return ONLY valid JSON matching the user's schema — no markdown fences, no commentary, no preamble. Your job is preservation, not summarization: keep every model variant, every feature, every claim.`;

  const userPrompt = `You are summarizing all the product information for a 1688 (Chinese supplier) product into a structured format. The product title is: "${productTitle}".

The corpus below has up to three sections, prefixed by === HEADERS ===:
1. **SUPPLIER ATTRIBUTE TABLE** — clean structured rows from the 1688 page state's featureAttributes JSON (Chinese name:value pairs). Authoritative source of truth for Brand / Model / Voltage / Material / Certifications / Origin / Control type / Applicable scenarios / etc. TRANSLATE the Chinese key names AND values to natural English.
2. **DESCRIPTION HTML TEXT** — flattened text from the description HTML body (often near-empty for image-heavy 1688 listings).
3. **IMAGE N TEXT (OCR)** — each description image OCR'd + translated. Will contain duplication, fragmentary phrases, OCR noise — that's expected.

Your job: extract a COMPLETE structured summary. Use this exact schema:

{
  "extractedSpecs": [{ "name": "<spec name>", "value": "<spec value>" }],
  "featureCallouts": ["<single-sentence feature description>"],
  "marketingAngles": ["<1-3 word use-case or buyer-persona theme>"]
}

CRITICAL RULES — DO NOT SUMMARIZE, DO NOT DROP:

extractedSpecs (hard product specs — Brand / Model / Item Number / Material / Finish / Dimensions / Heights / Widths / Power / Battery / Bulb / Voltage / Cable / Weight / Capacity / Color Temperature / Wattage / Control Type / Light Type / Certification / Certificate Number / Origin / Applicable Scenarios / Additional Features / Style / etc.):
- INCLUDE EVERY row from the SUPPLIER ATTRIBUTE TABLE that's a product spec. Translate Chinese keys/values to English.
- SKIP supplier-business attributes that aren't product specs ("Cross-border export specific source", "Main downstream platforms", "Has patent", etc.).
- KEEP EVERY MODEL VARIANT that appears anywhere in the corpus.
- KEEP per-model dimensions even when they look duplicated.
- KEEP measurement RANGES verbatim. NEVER round, NEVER collapse ranges to a single value.
- WHEN SUPPLIER TABLE AND OCR CONFLICT: trust the supplier table.

DIMENSIONS — special handling:
- If any IMAGE OCR section contains dimension annotations (e.g. "28.5cm" with arrows, "宽 15cm 高 40cm", "L×W×H 30×20×15cm", "直径 12cm"), emit a structured "Dimensions" spec entry. Values MUST be in US inches and MUST follow the canonical W×H×D format with letter suffixes:
  • 3D objects: "<W>"W × <H>"H × <D>"D" (e.g. 9.4"W × 9.4"H × 2.4"D)
  • 2D flat objects: "<W>"W × <H>"H"
  • Round / circular: "<W>"W × <H>"H" where W is the diameter and H is the thickness. NEVER write "Diameter" / "直径" — collapse to W.
  Convert from supplier units to inches: cm × 0.394, mm × 0.0394, both rounded to 1 decimal. Examples: "30 × 20 × 15 cm" → 11.8"W × 7.9"H × 5.9"D, "直径 12 cm × 4 cm" → 4.7"W × 1.6"H.
- COLLAPSE BY SHAPE, NOT DESIGN: dimensions almost always vary by shape (Round vs Square vs Rectangle), not by design name (Atelier vs Lumina vs Prism). If the same set of dimensions repeats across multiple designs of the same shape, emit ONE entry per shape — "Dimensions (Round)", "Dimensions (Square)", "Dimensions (Rectangle)" — NOT one per design. Only emit "Dimensions (<Design Name>)" when the dimensions genuinely differ between designs of the same shape.
- If the supplier table already has a Dimensions row, prefer that; only add OCR-extracted Dimensions when no supplier row exists OR when OCR reveals additional per-shape breakdowns the table doesn't have.
- Do NOT emit Dimensions entries from box/packaging photos (cardboard sleeves with shipping dims) — only product/swatch dimensions.

ORIGIN / "MADE IN CHINA" — strip giveaways:
- Do NOT emit any spec named "Origin" / "Country of Origin" / "Made In" / "Manufacturer Location" when the value reveals China (China, Mainland China, 中国, PRC, Guangdong, Shenzhen, Zhejiang, etc.). Drop the row entirely — don't substitute "Imported" or anything similar.
- Same for featureCallouts: do not mention China, Chinese manufacturing, "imported from Asia", or supplier-city names. Strip them silently.

featureCallouts (EVERY distinct product feature mentioned anywhere — 5-15 sentences, one feature per callout, factual):
- Include functional claims like "Long-press infinite dimming", "Telescopic pole adjusts from 12.4" to 15.4"", "USB-C charging port". Cite dimensions in inches (US units only) — apply the same cm × 0.394 / mm × 0.0394 conversion as the Dimensions rule.
- Skip pure fluff unless backed by a structural claim.

marketingAngles (2-8 short themes — 1-3 words each):
- Examples: "Bedside reading", "Portable lighting", "Refined living".

Return ONLY the JSON object. No markdown fences, no commentary.

Corpus:
${corpus.slice(0, 14000)}`;

  // 2-attempt retry: LLM JSON-parse failures are usually transient (stochastic
  // decoding glitches) and a clean retry typically succeeds. Without this, a
  // single bad token causes the entire enrichment to silently fall back to the
  // raw 1688 image-only HTML.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await claudeJSON({
        model: MODEL,
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 8192,
        schema: StructuredCorpusSchema,
      });
      return {
        extractedSpecs: parsed.extractedSpecs,
        featureCallouts: parsed.featureCallouts,
        marketingAngles: parsed.marketingAngles,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        await log(
          "warn",
          `[desc-enrichment] structuring attempt 1 failed (${msg.slice(0, 120)}) — retrying once`,
        );
        continue;
      }
      await log(
        "warn",
        `[desc-enrichment] structuring failed after 2 attempts: ${msg}`,
      );
      return { extractedSpecs: [], featureCallouts: [], marketingAngles: [] };
    }
  }
  return { extractedSpecs: [], featureCallouts: [], marketingAngles: [] };
}

/**
 * Live-variant summary passed to the description generator so it can drop or
 * adjust spec entries that reference axis values the user has since hidden or
 * removed. `axes` lists the unique values still offered on each axis after the
 * user's edits.
 */
export interface LiveVariantSummary {
  axes: Array<{ name: string; values: string[] }>;
  totalCount: number;
}

/**
 * Generate a simple Shopify-ready HTML description from the structured
 * productContext. Uses Claude Haiku 4.5 (replaces the legacy gpt-4o-mini call).
 *
 * Pass `liveVariants` when the description should reflect the user's current
 * variant selection (e.g. the "Rewrite description" button) — entries in
 * extractedSpecs that reference axis values absent from the live list should
 * be updated or dropped.
 */
async function generateDescriptionHtml(
  productTitle: string,
  context: ProductContext,
  log: LogFn,
  liveVariants?: LiveVariantSummary,
): Promise<string> {
  const userContent = `Product title: ${productTitle}

Structured product info (extracted from the supplier's description images via OCR):
${JSON.stringify(
  {
    marketingAngles: context.marketingAngles ?? [],
    extractedSpecs: context.extractedSpecs ?? [],
    featureCallouts: context.featureCallouts ?? [],
  },
  null,
  2,
)}${
    liveVariants
      ? `

Currently offered variants (after the user's edits — ${liveVariants.totalCount} live variant(s)):
${JSON.stringify(liveVariants.axes, null, 2)}`
      : ""
  }

Write the HTML description body now.`;

  const systemPrompt = `You are writing a SIMPLE Shopify product description body in HTML. A downstream rewrite rule will polish your output later — your job is just to lay out the factual content cleanly so the rewriter has good source material.

Output a single HTML <div> with exactly this structure:

<div>
  <p>One short paragraph (2-3 sentences) introducing the product. Weave in the marketingAngles tone but stay factual — don't invent claims.</p>

  <h3>Specifications</h3>
  <ul>
    <li><strong>Spec name:</strong> Spec value</li>
    <!-- one li per extractedSpec, in the order given -->
  </ul>

  <h3>Features</h3>
  <ul>
    <li>One featureCallout</li>
    <!-- one li per featureCallout, in the order given -->
  </ul>
</div>

Rules:
- Use values verbatim from extractedSpecs and featureCallouts. Don't paraphrase or invent.
- Skip any section that has zero entries (e.g. no specs → omit the Specifications section entirely).
- Plain HTML. No CSS, no inline styles, no extra divs. Title Case for headings.
- Return ONLY the <div>...</div> output. No markdown fences, no commentary, no preamble.
- If a "Currently offered variants" list is provided, it OVERRIDES extractedSpecs entries that reference variant axis values. Drop or trim any spec bullet that lists options no longer offered (e.g. spec says "Color Options: Gold, Black, Silver" but live axis only has Gold and Black → write "Color Options: Gold, Black"). Don't add bullets for axes that weren't already in extractedSpecs.
- DIMENSIONS — PER-STYLE PRESERVATION IS MANDATORY: render EVERY "Dimensions (...)" spec entry from extractedSpecs verbatim, AS ITS OWN ROW. Use the W×H×D format (e.g. "9.4"W × 9.4"H × 2.4"D" or "9.4"W × 2.4"H" for round). The parenthetical label (e.g. "Dimensions (Yunshi Small)", "Dimensions (Jingyu)", "Dimensions (2-Head)", "Minglan, Shuya Dimensions") MUST appear in the output exactly as given — DO NOT rename "Yunshi Small" to "Small", DO NOT collapse "(2-Head)" into a generic "Small", DO NOT drop the style name. Only collapse two rows into one when the values are IDENTICAL AND the parenthetical labels refer to the same axis category (e.g. two "Dimensions (Round Small)" rows with same value → one row). When labels refer to different style/model/configuration names, keep them separate. Same rule applies to any per-variant spec ("Light Source Power (Small/Medium)", "Applicable Area (14W)", "Coverage Area (2-Head)") — preserve verbatim, one row each.
- HIDE CHINA: DROP any spec whose name is "Origin", "Country of Origin", "Made In", "Manufacturer Location", or whose value mentions China / Mainland China / 中国 / PRC / Chinese cities (Guangdong, Shenzhen, Zhejiang, Yiwu, etc.). Same for featureCallouts — do not surface anything that reveals Chinese supplier origin.`;

  try {
    const raw = await claudeText({
      model: MODEL,
      system: systemPrompt,
      user: userContent,
      maxTokens: 1500,
      temperature: 0.3,
    });
    const cleaned = raw
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    if (!cleaned.startsWith("<")) {
      await log(
        "warn",
        `[desc-enrichment] description generation returned non-HTML (starts with "${cleaned.slice(0, 40)}")`,
      );
      return "";
    }
    return cleaned;
  } catch (err) {
    await log(
      "warn",
      `[desc-enrichment] description generation failed: ${err instanceof Error ? err.message : err}`,
    );
    return "";
  }
}

/**
 * Build the OCR corpus by interleaving the supplier attribute table (if known),
 * the description HTML text, and each per-image OCR result.
 */
function buildCorpus(args: {
  supplierAttributes?: Array<{ name: string; value: string }>;
  supplierWeightG?: number;
  descriptionHtml?: string;
  imageTexts: string[];
}): string {
  const parts: string[] = [];

  if (
    (args.supplierAttributes && args.supplierAttributes.length > 0) ||
    args.supplierWeightG !== undefined
  ) {
    const lines = (args.supplierAttributes ?? []).map((a) => `- ${a.name}: ${a.value}`);
    if (args.supplierWeightG !== undefined) {
      lines.push(`- 重量 (Weight): ${args.supplierWeightG} g`);
    }
    parts.push(
      `=== SUPPLIER ATTRIBUTE TABLE (verbatim rows from the 1688 product page; Chinese — translate to English when structuring) ===\n${lines.join("\n")}`,
    );
  }

  if (args.descriptionHtml) {
    const descText = args.descriptionHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (descText) parts.push(`=== DESCRIPTION HTML TEXT ===\n${descText}`);
  }

  for (let i = 0; i < args.imageTexts.length; i++) {
    const t = args.imageTexts[i];
    if (t && t.length > 30) parts.push(`=== IMAGE ${i + 1} TEXT (OCR) ===\n${t}`);
  }

  return parts.join("\n\n");
}

export interface EnrichDescriptionOptions {
  /**
   * Optional pre-known supplier attributes (Chinese name/value rows from the
   * 1688 page's `featureAttributes` JSON). Passed through to the structuring
   * call to anchor on the authoritative source of truth.
   */
  supplierAttributes?: Array<{ name: string; value: string }>;
  supplierWeightG?: number;
  /**
   * Whether to pre-filter images with a batched YES/NO text-presence check.
   * Defaults to true — fails open if the pre-filter errors.
   */
  prefilter?: boolean;
  /**
   * Optional URLs of swatch (variant thumbnail) images. Used as the LAST-RESORT
   * tier in the dimension-extraction fallback chain: only OCR'd when tiers 1-3
   * (specs / packing / description-OCR) produced no Dimensions row. Capped at
   * SWATCH_OCR_CAP — most products won't hit this tier at all.
   */
  swatchImageUrls?: string[];
  log?: LogFn;
}

export interface EnrichDescriptionResult {
  descriptionHtml: string;
  productContext: ProductContext;
}

/**
 * Main entry point.
 *
 * Reads the product's title + descriptionHtml + supplier attribute snapshot,
 * runs OCR on every <img> URL (capped at 20, parallelism 3), structures the
 * corpus into specs/callouts/angles via Claude JSON, and finally generates a
 * simple Shopify-ready HTML description.
 *
 * Returns the new HTML + the ProductContext shape used by the NEW project.
 * Does NOT touch the database — caller persists.
 */
export async function enrichDescription1688(
  product: ScrapedProduct,
  options: EnrichDescriptionOptions = {},
): Promise<EnrichDescriptionResult> {
  const log = options.log ?? noopLog;

  if (!isClaudeConfigured()) {
    await log(
      "warn",
      "[desc-enrichment] ANTHROPIC_API_KEY not set — returning empty enrichment",
    );
    return {
      descriptionHtml: product.descriptionHtml ?? "",
      productContext: {
        extractedSpecs: [],
        featureCallouts: [],
        marketingAngles: [],
        ...(options.supplierAttributes
          ? { supplierAttributes: options.supplierAttributes }
          : {}),
        ...(options.supplierWeightG !== undefined
          ? { supplierWeightG: options.supplierWeightG }
          : {}),
      },
    };
  }

  // 1) Extract image URLs (cap 20)
  const allUrls = product.descriptionHtml ? extractImageUrls(product.descriptionHtml) : [];
  const cappedUrls = allUrls.slice(0, MAX_IMAGES_PER_SCRAPE);
  const skipped = allUrls.length - cappedUrls.length;

  await log(
    "info",
    `[desc-enrichment] Inputs — ${cappedUrls.length} description image(s) candidate (${skipped} skipped over cap), ${options.supplierAttributes?.length ?? 0} supplier attribute row(s)`,
  );

  // 2) Optional pre-filter
  const prefilterEnabled = options.prefilter !== false && cappedUrls.length > 0;
  const urls = prefilterEnabled
    ? await filterImagesWithText(cappedUrls, log)
    : cappedUrls;

  // 3) Parallel OCR (cap 3)
  const startMs = Date.now();
  const ocrResults =
    urls.length > 0
      ? await parallelWithLimit(urls, PARALLEL_OCR_CALLS, async (url, i) => {
          const text = await ocrSingleImage(url);
          if (!text) {
            await log(
              "warn",
              `[desc-enrichment]   image ${i + 1}/${urls.length} OCR failed/empty`,
            );
          }
          return text;
        })
      : [];
  await log(
    "info",
    `[desc-enrichment] Claude OCR done in ${Date.now() - startMs}ms (${urls.length} image(s))`,
  );

  // 4) Build corpus + structure
  const corpus = buildCorpus({
    supplierAttributes: options.supplierAttributes,
    supplierWeightG: options.supplierWeightG,
    descriptionHtml: product.descriptionHtml,
    imageTexts: ocrResults,
  });

  const structureStart = Date.now();
  const structured = await structureCorpus(product.title, corpus, log);
  await log(
    "info",
    `[desc-enrichment] Structured corpus in ${Date.now() - structureStart}ms — ${structured.extractedSpecs.length} specs, ${structured.featureCallouts.length} callouts, ${structured.marketingAngles.length} angles`,
  );

  // 4b) Swatch-OCR fallback for dimensions. Only fires when tiers 1-3 produced
  //     no Dimensions row in extractedSpecs. Sequential, stops on first hit,
  //     hard-capped at SWATCH_OCR_CAP — typical worst case ~$0.03.
  const hasDimensions = structured.extractedSpecs.some((s) =>
    /dimension/i.test(s.name),
  );
  if (!hasDimensions && (options.swatchImageUrls?.length ?? 0) > 0) {
    const swatches = (options.swatchImageUrls ?? []).slice(0, SWATCH_OCR_CAP);
    await log(
      "info",
      `[desc-enrichment] No Dimensions row found — falling back to swatch OCR (${swatches.length} swatch(es), cap ${SWATCH_OCR_CAP})`,
    );
    const swatchStart = Date.now();
    let foundDim: string | null = null;
    let triedCount = 0;
    for (const url of swatches) {
      triedCount++;
      const dim = await ocrSwatchForDimensions(url);
      if (dim) {
        foundDim = dim;
        break;
      }
    }
    if (foundDim) {
      structured.extractedSpecs.push({ name: "Dimensions", value: foundDim });
      await log(
        "info",
        `[desc-enrichment] Swatch OCR hit on swatch ${triedCount}/${swatches.length} in ${Date.now() - swatchStart}ms — "${foundDim}"`,
      );
    } else {
      await log(
        "info",
        `[desc-enrichment] Swatch OCR found no dimensions across ${triedCount} swatch(es) in ${Date.now() - swatchStart}ms`,
      );
    }
  }

  const productContext: ProductContext = {
    extractedSpecs: structured.extractedSpecs,
    featureCallouts: structured.featureCallouts,
    marketingAngles: structured.marketingAngles,
    ...(options.supplierAttributes
      ? { supplierAttributes: options.supplierAttributes }
      : {}),
    ...(options.supplierWeightG !== undefined
      ? { supplierWeightG: options.supplierWeightG }
      : {}),
  };

  // 5) Generate clean HTML from the structured content whenever we have any.
  //    The raw 1688 descriptionHtml is almost always a "店铺推荐" cross-sell
  //    grid + image dump — never useful as-is. If structuring produced specs
  //    or callouts, ALWAYS prefer the LLM-generated version. Only fall through
  //    to the raw HTML when there is literally nothing structured to render.
  const hasMeaningfulContent =
    structured.extractedSpecs.length > 0 || structured.featureCallouts.length > 0;

  let descriptionHtml = product.descriptionHtml ?? "";
  if (hasMeaningfulContent) {
    const generated = await generateDescriptionHtml(product.title, productContext, log);
    if (generated) {
      descriptionHtml = generated;
      await log(
        "info",
        `[desc-enrichment] Generated ${generated.length}-char description from productContext`,
      );
    } else {
      await log(
        "warn",
        `[desc-enrichment] generateDescriptionHtml returned empty — keeping raw 1688 HTML as fallback`,
      );
    }
  } else {
    await log(
      "info",
      `[desc-enrichment] No structured content (0 specs, 0 callouts) — keeping raw 1688 HTML`,
    );
  }

  return { descriptionHtml, productContext };
}

// ---------------------------------------------------------------------------
// Rewrite-only path — used by the "Rewrite description" button on /review.
// ---------------------------------------------------------------------------

export interface RewriteDescriptionResult {
  descriptionHtml: string;
  liveVariantCount: number;
  hadCachedContext: boolean;
}

/**
 * Regenerate Product.descriptionHtml from the cached productContext and the
 * product's CURRENT live (non-hidden) variants — does NOT re-run OCR or the
 * structuring call. One Claude call (~$0.001), ~3s.
 *
 * Intended for the "Rewrite description" button on /review: the user has
 * edited variants (hidden some, reordered, removed images) and wants the
 * description text to reflect those edits without paying for full re-enrichment.
 *
 * If no cached productContext exists (very old products predating Phase 2
 * enrichment), the function bails out with an empty result rather than
 * guessing — caller should surface that to the user as "no enrichment data".
 */
export async function rewriteProductDescription(
  productId: string,
): Promise<RewriteDescriptionResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: {
        where: { isHidden: false },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  // Parse cached productContext from Phase 2 enrichment.
  let context: ProductContext | null = null;
  if (product.productContext) {
    try {
      const parsed = JSON.parse(product.productContext) as ProductContext;
      if (
        Array.isArray(parsed.extractedSpecs) ||
        Array.isArray(parsed.featureCallouts) ||
        Array.isArray(parsed.marketingAngles)
      ) {
        context = parsed;
      }
    } catch {
      // fall through
    }
  }
  if (!context) {
    return {
      descriptionHtml: product.descriptionHtml ?? "",
      liveVariantCount: product.variants.length,
      hadCachedContext: false,
    };
  }

  // Build live-variant summary by axis. optionNames is the source of truth
  // for axis labels; unique non-empty values per slot give the user's current
  // offering.
  let axisLabels: string[] = [];
  if (product.optionNames) {
    try {
      const parsed = JSON.parse(product.optionNames);
      if (Array.isArray(parsed)) {
        axisLabels = parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      // ignore
    }
  }
  const axes: Array<{ name: string; values: string[] }> = [];
  for (let i = 0; i < axisLabels.length; i++) {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const v of product.variants) {
      const slot = [v.option1, v.option2, v.option3][i];
      if (slot && !seen.has(slot)) {
        seen.add(slot);
        values.push(slot);
      }
    }
    if (values.length > 0) {
      axes.push({ name: axisLabels[i], values });
    }
  }
  const liveSummary: LiveVariantSummary = {
    axes,
    totalCount: product.variants.length,
  };

  if (!isClaudeConfigured()) {
    return {
      descriptionHtml: product.descriptionHtml ?? "",
      liveVariantCount: product.variants.length,
      hadCachedContext: true,
    };
  }

  const generated = await generateDescriptionHtml(
    product.title,
    context,
    noopLog,
    liveSummary,
  );

  const newHtml = generated || product.descriptionHtml || "";
  if (generated) {
    await prisma.product.update({
      where: { id: productId },
      data: { descriptionHtml: newHtml },
    });
  }

  return {
    descriptionHtml: newHtml,
    liveVariantCount: product.variants.length,
    hadCachedContext: true,
  };
}
