/**
 * A/B TEST: Claude vs Gemini for 1688 description-image analysis (OCR).
 *
 * Re-fetches ONE already-scraped product's exact description images (via the
 * same desc-fetcher the real scraper uses), then runs the Phase-2 enrichment
 * VISION step both ways on the identical image set:
 *   - Claude Haiku 4.5 (the production path)
 *   - Gemini 2.5 Flash
 *
 * The downstream text-only steps (structuring + HTML generation) are held
 * CONSTANT (both use Claude) so any difference in the final specs/description is
 * attributable purely to the vision model's OCR quality.
 *
 * Prompts, schema, corpus-builder, and URL-extractor are copied VERBATIM from
 * src/services/description-enrichment.service.ts so the comparison faithfully
 * reproduces the real pipeline.
 *
 * Writes artifacts to .tmp-ab/out/. Safe to delete after running.
 */
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { fetch1688Description } from "../src/lib/scraper/desc-fetcher";
import { claudeJSON, claudeText } from "../src/lib/ai/claude-client";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// ── Config ──────────────────────────────────────────────────────────────────
const PRODUCT_ID = process.argv[2] || "cmpzizk0000dxw2hslceyrlaz"; // watch w/ rich Chinese spec images
const CLAUDE_MODEL = "claude-haiku-4-5";
const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_IMAGES_PER_SCRAPE = 20;
const PARALLEL_OCR_CALLS = 3;
const OCR_MAX_TOKENS = 2048;
// Approximate published per-1M-token rates (USD) — adjust if needed.
const RATES = {
  [CLAUDE_MODEL]: { in: 1.0, out: 5.0 },
  [GEMINI_MODEL]: { in: 0.3, out: 2.5 },
} as const;

const OUT = path.resolve(process.cwd(), ".tmp-ab", "out");
fs.mkdirSync(OUT, { recursive: true });

// ── Prompts / schema copied VERBATIM from description-enrichment.service.ts ───
const OCR_PROMPT = `This is a Chinese 1688 product description image. It often contains GRIDS, TABLES, or LABELED DIAGRAMS with many data cells (model labels, dimensions, units, height ranges, feature callouts).

EXHAUSTIVELY extract EVERY VISIBLE PIECE OF TEXT — every label, every number, every unit, every section heading, every measurement. Do NOT summarize. Do NOT skip cells that look duplicated. Do NOT collapse a grid into prose.

Format your output as ONE PIECE OF INFO PER LINE. Preserve grid/table structure where possible (e.g. "A款 | width 15cm | height 40.5cm"). Translate Chinese alongside English in parentheses.

If the image has sections (e.g. retractable vs non-retractable), label each section clearly.

If there are diagrams with measurement arrows + numbers (e.g. a lamp with height/width labels), extract every number with its associated dimension.

Be thorough — missing details from this image lose product information downstream. If the image truly has no visible text, say so explicitly.`;

const StructuredCorpusSchema = z.object({
  extractedSpecs: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  featureCallouts: z.array(z.string()).default([]),
  marketingAngles: z.array(z.string()).default([]),
});
type Structured = z.infer<typeof StructuredCorpusSchema>;

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

function buildCorpus(args: {
  supplierAttributes?: Array<{ name: string; value: string }>;
  supplierWeightG?: number;
  descriptionHtml?: string;
  imageTexts: string[];
}): string {
  const parts: string[] = [];
  if ((args.supplierAttributes && args.supplierAttributes.length > 0) || args.supplierWeightG !== undefined) {
    const lines = (args.supplierAttributes ?? []).map((a) => `- ${a.name}: ${a.value}`);
    if (args.supplierWeightG !== undefined) lines.push(`- 重量 (Weight): ${args.supplierWeightG} g`);
    parts.push(
      `=== SUPPLIER ATTRIBUTE TABLE (verbatim rows from the 1688 product page; Chinese — translate to English when structuring) ===\n${lines.join("\n")}`,
    );
  }
  if (args.descriptionHtml) {
    const descText = args.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (descText) parts.push(`=== DESCRIPTION HTML TEXT ===\n${descText}`);
  }
  for (let i = 0; i < args.imageTexts.length; i++) {
    const t = args.imageTexts[i];
    if (t && t.length > 30) parts.push(`=== IMAGE ${i + 1} TEXT (OCR) ===\n${t}`);
  }
  return parts.join("\n\n");
}

// structureCorpus prompts (verbatim)
const STRUCT_SYSTEM = `You convert a noisy OCR corpus into a COMPLETE structured JSON summary. Return ONLY valid JSON matching the user's schema — no markdown fences, no commentary, no preamble. Your job is preservation, not summarization: keep every model variant, every feature, every claim.`;
function structUserPrompt(productTitle: string, corpus: string): string {
  return `You are summarizing all the product information for a 1688 (Chinese supplier) product into a structured format. The product title is: "${productTitle}".

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

ZERO BRANDS — strip every brand/manufacturer mention (this store sells UNBRANDED):
- Do NOT emit any spec named "Brand" / "Movement Brand" / "Manufacturer" / "Maker" / "Trademark" / "Logo" / "LED Chip Brand", or whose VALUE is a brand/manufacturer/movement name (e.g. POEDAGAR, Genven, Chenlong, MIYOTA, Citizen, Seiko, Rolex, Submariner). Drop the row entirely.
- Do NOT put a brand/manufacturer name in any OTHER spec value either (e.g. "Movement: Japanese quartz", not "Movement: MIYOTA").
- Strip all OEM / wholesale / private-label language from featureCallouts and marketingAngles: "OEM", "custom logo", "logo printing", "branded resale", "branding ready", "private label", "for branding/promotions". These are B2B supplier terms.

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
}

async function structureCorpus(productTitle: string, corpus: string): Promise<Structured> {
  const parsed = await claudeJSON<Structured>({
    model: CLAUDE_MODEL,
    system: STRUCT_SYSTEM,
    user: structUserPrompt(productTitle, corpus),
    maxTokens: 8192,
    schema: StructuredCorpusSchema,
  });
  const BRAND_SPEC_NAME = /\b(brand|manufacturer|maker|trademark|logo|oem)\b/i;
  const BRAND_TEXT = /\b(oem|private[\s-]?label|custom logo|logo print|logo customiz|branded|branding)\b/i;
  return {
    extractedSpecs: parsed.extractedSpecs.filter((s) => !BRAND_SPEC_NAME.test(s.name)),
    featureCallouts: parsed.featureCallouts.filter((c) => !BRAND_TEXT.test(c)),
    marketingAngles: parsed.marketingAngles.filter((m) => !BRAND_TEXT.test(m)),
  };
}

// generateDescriptionHtml (verbatim prompts)
const GEN_SYSTEM = `You are writing a SIMPLE Shopify product description body in HTML. A downstream rewrite rule will polish your output later — your job is just to lay out the factual content cleanly so the rewriter has good source material.

Output a single HTML <div> with exactly this structure:

<div>
  <p>One short paragraph (2-3 sentences) introducing the product. Weave in the marketingAngles tone but stay factual — don't invent claims.</p>

  <h3>Specifications</h3>
  <ul>
    <li><strong>Spec name:</strong> Spec value</li>
  </ul>

  <h3>Features</h3>
  <ul>
    <li>One featureCallout</li>
  </ul>
</div>

Rules:
- Use values verbatim from extractedSpecs and featureCallouts. Don't paraphrase or invent.
- Skip any section that has zero entries.
- Plain HTML. No CSS, no inline styles, no extra divs. Title Case for headings.
- Return ONLY the <div>...</div> output. No markdown fences, no commentary, no preamble.
- DIMENSIONS — render EVERY "Dimensions (...)" spec entry verbatim, AS ITS OWN ROW, preserving the parenthetical label exactly.
- HIDE CHINA / ZERO BRANDS as appropriate.`;
async function generateDescriptionHtml(productTitle: string, context: Structured): Promise<string> {
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
)}

Write the HTML description body now.`;
  const raw = await claudeText({
    model: CLAUDE_MODEL,
    system: GEN_SYSTEM,
    user: userContent,
    maxTokens: 1500,
    temperature: 0.3,
  });
  return raw.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
}

// ── Bounded-concurrency map ───────────────────────────────────────────────────
async function parallelWithLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// ── Vision calls (replicated inline so we feed IDENTICAL bytes + capture tokens)─
type Usage = { inTok: number; outTok: number };
type VisionResult = { text: string; ms: number; usage: Usage; error?: string };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function normMime(mime: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const t = (mime || "image/jpeg").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/png" || t === "image/gif" || t === "image/webp") return t;
  return "image/jpeg";
}

async function claudeOcr(b64: string, mime: string): Promise<VisionResult> {
  const t0 = Date.now();
  try {
    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: OCR_MAX_TOKENS,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: normMime(mime), data: b64 } },
            { type: "text", text: OCR_PROMPT },
          ],
        },
      ],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
    return { text, ms: Date.now() - t0, usage: { inTok: res.usage.input_tokens, outTok: res.usage.output_tokens } };
  } catch (e) {
    return { text: "", ms: Date.now() - t0, usage: { inTok: 0, outTok: 0 }, error: e instanceof Error ? e.message : String(e) };
  }
}

const GEMINI_KEY = process.env.GEMINI_VISION_API_KEY || process.env.GEMINI_API_KEY!;
async function geminiOcr(b64: string, mime: string): Promise<VisionResult> {
  const t0 = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: normMime(mime), data: b64 } }, { text: OCR_PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: OCR_MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } },
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        lastErr = `HTTP ${res.status}: ${b.slice(0, 200)}`;
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
          continue;
        }
        return { text: "", ms: Date.now() - t0, usage: { inTok: 0, outTok: 0 }, error: lastErr };
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? "").join("").trim();
      return {
        text,
        ms: Date.now() - t0,
        usage: { inTok: json.usageMetadata?.promptTokenCount ?? 0, outTok: json.usageMetadata?.candidatesTokenCount ?? 0 },
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  return { text: "", ms: Date.now() - t0, usage: { inTok: 0, outTok: 0 }, error: lastErr };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { id: true, title: true, rawPayload: true },
  });
  if (!product) throw new Error(`Product ${PRODUCT_ID} not found`);
  const rp = JSON.parse(product.rawPayload) as {
    descriptionUrl?: string;
    featureAttributes?: Array<{ name: string; value: string }>;
    productWeightG?: number;
  };
  await prisma.$disconnect();

  console.log(`\n=== A/B: Claude vs Gemini image analysis ===`);
  console.log(`Product: ${product.title}`);
  console.log(`ID: ${product.id}`);
  console.log(`descriptionUrl: ${rp.descriptionUrl}\n`);

  // 1) Re-fetch the exact description images (same code the scraper uses)
  const desc = await fetch1688Description(rp.descriptionUrl);
  if (!desc) throw new Error("fetch1688Description returned null — descriptionUrl may be stale; a fresh page scrape would be needed");
  const allUrls = extractImageUrls(desc.html);
  const urls = allUrls.slice(0, MAX_IMAGES_PER_SCRAPE);
  console.log(`Description HTML: ${desc.html.length} bytes, ${allUrls.length} image(s) → OCRing ${urls.length} (cap ${MAX_IMAGES_PER_SCRAPE})\n`);

  // 2) Download each image ONCE so both providers see identical bytes
  const imgs = await parallelWithLimit(urls, 6, async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) return { url: u, b64: null as string | null, mime: "image/jpeg", bytes: 0 };
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get("content-type") || "image/jpeg";
      return { url: u, b64: buf.toString("base64"), mime, bytes: buf.length };
    } catch {
      return { url: u, b64: null as string | null, mime: "image/jpeg", bytes: 0 };
    }
  });
  const ok = imgs.filter((i) => i.b64);
  console.log(`Downloaded ${ok.length}/${urls.length} images (${imgs.filter((i) => !i.b64).length} failed)\n`);

  // 3) OCR each image with BOTH providers (identical bytes)
  console.log(`Running Claude OCR (${CLAUDE_MODEL})...`);
  const claudeRes = await parallelWithLimit(imgs, PARALLEL_OCR_CALLS, async (im, i) => {
    if (!im.b64) return { text: "", ms: 0, usage: { inTok: 0, outTok: 0 }, error: "download failed" } as VisionResult;
    const r = await claudeOcr(im.b64, im.mime);
    process.stdout.write(`  [claude ${i + 1}/${imgs.length}] ${r.ms}ms ${r.text.length}ch ${r.error ? "ERR:" + r.error.slice(0, 60) : ""}\n`);
    return r;
  });
  console.log(`\nRunning Gemini OCR (${GEMINI_MODEL})...`);
  const geminiRes = await parallelWithLimit(imgs, PARALLEL_OCR_CALLS, async (im, i) => {
    if (!im.b64) return { text: "", ms: 0, usage: { inTok: 0, outTok: 0 }, error: "download failed" } as VisionResult;
    const r = await geminiOcr(im.b64, im.mime);
    process.stdout.write(`  [gemini ${i + 1}/${imgs.length}] ${r.ms}ms ${r.text.length}ch ${r.error ? "ERR:" + r.error.slice(0, 60) : ""}\n`);
    return r;
  });

  // 4) Build two corpora (identical supplier attrs; only OCR text differs)
  const corpusClaude = buildCorpus({
    supplierAttributes: rp.featureAttributes,
    supplierWeightG: rp.productWeightG,
    descriptionHtml: desc.html,
    imageTexts: claudeRes.map((r) => r.text),
  });
  const corpusGemini = buildCorpus({
    supplierAttributes: rp.featureAttributes,
    supplierWeightG: rp.productWeightG,
    descriptionHtml: desc.html,
    imageTexts: geminiRes.map((r) => r.text),
  });

  // 5) Structure both with the SAME model (Claude) — isolates the vision variable
  console.log(`\nStructuring both corpora (Claude, held constant)...`);
  const [structClaude, structGemini] = await Promise.all([
    structureCorpus(product.title, corpusClaude),
    structureCorpus(product.title, corpusGemini),
  ]);

  // 6) Generate descriptions from both
  const [descClaude, descGemini] = await Promise.all([
    generateDescriptionHtml(product.title, structClaude),
    generateDescriptionHtml(product.title, structGemini),
  ]);

  // ── Write artifacts ──────────────────────────────────────────────────────────
  const sum = (rs: VisionResult[], key: "inTok" | "outTok") => rs.reduce((a, r) => a + r.usage[key], 0);
  const cost = (rs: VisionResult[], model: keyof typeof RATES) =>
    (sum(rs, "inTok") / 1e6) * RATES[model].in + (sum(rs, "outTok") / 1e6) * RATES[model].out;
  const totMs = (rs: VisionResult[]) => rs.reduce((a, r) => a + r.ms, 0);
  const chars = (rs: VisionResult[]) => rs.reduce((a, r) => a + r.text.length, 0);

  // per-image markdown
  let perImg = `# Per-image OCR: Claude vs Gemini\n\nProduct: ${product.title} (${product.id})\n\n`;
  for (let i = 0; i < imgs.length; i++) {
    perImg += `\n\n---\n\n## Image ${i + 1}  (${imgs[i].bytes} bytes, ${imgs[i].mime})\n${imgs[i].url}\n\n`;
    perImg += `### Claude (${claudeRes[i].ms}ms, ${claudeRes[i].text.length}ch, in=${claudeRes[i].usage.inTok} out=${claudeRes[i].usage.outTok})${claudeRes[i].error ? " ERROR: " + claudeRes[i].error : ""}\n\n\`\`\`\n${claudeRes[i].text || "(empty)"}\n\`\`\`\n\n`;
    perImg += `### Gemini (${geminiRes[i].ms}ms, ${geminiRes[i].text.length}ch, in=${geminiRes[i].usage.inTok} out=${geminiRes[i].usage.outTok})${geminiRes[i].error ? " ERROR: " + geminiRes[i].error : ""}\n\n\`\`\`\n${geminiRes[i].text || "(empty)"}\n\`\`\`\n`;
  }
  fs.writeFileSync(path.join(OUT, "per-image.md"), perImg);
  fs.writeFileSync(path.join(OUT, "corpus-claude.txt"), corpusClaude);
  fs.writeFileSync(path.join(OUT, "corpus-gemini.txt"), corpusGemini);
  fs.writeFileSync(path.join(OUT, "structured-claude.json"), JSON.stringify(structClaude, null, 2));
  fs.writeFileSync(path.join(OUT, "structured-gemini.json"), JSON.stringify(structGemini, null, 2));
  fs.writeFileSync(path.join(OUT, "desc-claude.html"), descClaude);
  fs.writeFileSync(path.join(OUT, "desc-gemini.html"), descGemini);

  const summary = {
    product: { id: product.id, title: product.title },
    images: { fetched: allUrls.length, ocred: imgs.length, downloaded: ok.length },
    claude: {
      model: CLAUDE_MODEL,
      totalVisionMs: totMs(claudeRes),
      avgMsPerImage: Math.round(totMs(claudeRes) / Math.max(1, imgs.length)),
      totalOcrChars: chars(claudeRes),
      inTok: sum(claudeRes, "inTok"),
      outTok: sum(claudeRes, "outTok"),
      approxVisionCostUsd: +cost(claudeRes, CLAUDE_MODEL).toFixed(4),
      emptyOrError: claudeRes.filter((r) => !r.text).length,
      specs: structClaude.extractedSpecs.length,
      callouts: structClaude.featureCallouts.length,
      dimensionSpecs: structClaude.extractedSpecs.filter((s) => /dimension/i.test(s.name)),
      descLen: descClaude.length,
    },
    gemini: {
      model: GEMINI_MODEL,
      totalVisionMs: totMs(geminiRes),
      avgMsPerImage: Math.round(totMs(geminiRes) / Math.max(1, imgs.length)),
      totalOcrChars: chars(geminiRes),
      inTok: sum(geminiRes, "inTok"),
      outTok: sum(geminiRes, "outTok"),
      approxVisionCostUsd: +cost(geminiRes, GEMINI_MODEL).toFixed(4),
      emptyOrError: geminiRes.filter((r) => !r.text).length,
      specs: structGemini.extractedSpecs.length,
      callouts: structGemini.featureCallouts.length,
      dimensionSpecs: structGemini.extractedSpecs.filter((s) => /dimension/i.test(s.name)),
      descLen: descGemini.length,
    },
    note: "Downstream structuring + HTML generation held constant (both Claude) so differences are attributable to the vision OCR provider.",
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nArtifacts written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
