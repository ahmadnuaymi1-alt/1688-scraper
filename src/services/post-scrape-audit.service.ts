/**
 * Post-scrape audit service.
 *
 * Runs a series of auto-fix checks on a product after Phase 2 of the scraper
 * pipeline (or on-demand via the per-product / bulk audit endpoints). Each
 * check returns a structured result; fixes are persisted directly to the DB
 * and logged to the scrape JobLog so the user can see what changed.
 *
 * Checks (in order):
 *   1. Waffle SKU rename — variant option values matching shapes like
 *      "Wybd0013", "JK-1", "Model 682" get renamed via Claude vision using
 *      the variant's reference image.
 *   2. Variants without source images — link unlinked variants to a sensible
 *      source image so the hero pipeline doesn't silently skip them.
 *   3. Pack-axis remnants — hide variants whose options contain "double pack",
 *      "2-pack", "双个装" etc. (curation should have killed them; sometimes
 *      they leak through).
 *   4. Empty/redundant axes — drop any axis where every visible variant has
 *      a null/empty value on it.
 *   5. Size-axis image unification — when sizes vary within a color, share
 *      one image across all sizes of that color (saves hero credits + keeps
 *      the gallery consistent). Also converts cm/mm/m values to inches.
 *   6. Image-only description retry — when the description is just images
 *      with no extracted text, retry enrichDescription1688() once.
 *
 * All checks are non-fatal. A failure in one is logged + skipped; later
 * checks still run. The caller gets an aggregate AuditResult.
 */
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { addJobLog } from "@/lib/jobs/queue";
import { claudeJSON, claudeVision, isClaudeConfigured } from "@/lib/ai/claude-client";
import {
  enrichDescription1688,
  rewriteProductDescription,
} from "@/services/description-enrichment.service";
import { ScrapeOptionsSchema } from "@/types/scrape-options";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditCheckResult {
  check: string;
  checked: number;
  fixed: number;
  flagged: number;
  details: string[];
}

export interface AuditResult {
  productId: string;
  checks: AuditCheckResult[];
  totalFixed: number;
  totalFlagged: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const OPT_KEYS = ["option1", "option2", "option3"] as const;
type OptKey = (typeof OPT_KEYS)[number];

/**
 * Match obvious supplier-SKU patterns that surface as user-visible variant
 * option values. Extend this list as new shapes appear.
 *   - Leading alpha prefix followed by digits: "Wybd0013", "Hl-12", "Nx005"
 *   - "Model" / "Style" / "Type" prefix + number: "Model 682"
 *   - All-caps short codes with digits: "JK-1", "WB-12A", "K3"
 *   - Pure-numeric supplier IDs: "12345", "682"
 */
const WAFFLE_SKU_PATTERNS: RegExp[] = [
  /^(wybd|jk|hl|wb|nx|zx|kx|sd|td|hd|md|pd|gd|yd|nd|ld|fd|cd)[\-_]?\d+[a-z]?$/i,
  /^model\s*\d+[a-z]?$/i,
  /^style\s*\d+[a-z]?$/i,
  /^type\s*\d+[a-z]?$/i,
  // "Design A", "Style B", "Model A1", "Version C", "Colour B", "Option D" —
  // a generic-noun prefix + a LETTER-led code is an opaque supplier code with
  // no customer meaning → vision-rename it to a descriptive name. (The digit-
  // suffixed forms above already cover "Style 2"; this adds the letter forms.)
  // Excludes "Type X" (would catch USB "Type C") and never matches bare bulb
  // bases like E27/G9 (no prefix word) or sizes S/M/L.
  /^(design|style|model|version|colou?r|spec|item|variant|option|no\.?|number)\s*[-_]?\s*[A-Za-z]\d{0,2}$/i,
  /^[A-Z]{2,4}[\-_]?\d{1,4}[A-Z]?$/,
  /^\d{3,}$/, // pure numeric supplier ID
];

function isWaffleSkuValue(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  return WAFFLE_SKU_PATTERNS.some((re) => re.test(trimmed));
}

/** Axis NAMES whose values should be replaced with random model-pool names
 *  rather than vision-derived descriptive names. Word-boundary match so
 *  "Shade Style" / "Body Style" / "Lamp Model" all qualify, while non-style
 *  axes like "Finish" / "Color" / "Direction" don't. */
const STYLE_AXIS_NAME_RE = /\b(style|model|type|series|sku|item|design|collection)\b/i;

/** Curated pool of model-style names. Distinct enough that 80 products can
 *  cycle through without obvious repetition; alphabetical-ish so consecutive
 *  picks within a product feel intentional. */
const MODEL_NAME_POOL = [
  "Aurora", "Vela", "Halo", "Lumen", "Sera", "Nox", "Orin", "Eden",
  "Lyra", "Mira", "Atlas", "Onyx", "Sable", "Cove", "Linden", "Pier",
  "Solace", "Cassia", "Bramble", "Cinder", "Marlow", "Quill", "Sage",
  "Wren", "Tamsin", "Indigo", "Larkspur", "Juno", "Calla", "Briar",
  "Dune", "Ember", "Fjord", "Glade", "Haven", "Iris", "Juniper", "Kestrel",
  "Loam", "Meadow", "Nimbus", "Olive", "Petal", "Quartz", "Ridge", "Sienna",
  "Tide", "Umber", "Vesper", "Willow", "Yarrow", "Zephyr", "Alder", "Bay",
  "Cedar", "Drift", "Echo", "Fern", "Grove", "Hazel", "Ivy", "Jade",
  "Kiln", "Lark", "Mosaic", "Nest", "Oak", "Plum", "Quay", "Rain",
  "Stone", "Twine", "Vale", "Wisp", "Aster", "Birch", "Clove", "Dahlia",
];

/** Stable hash → int for deriving a per-product offset into MODEL_NAME_POOL,
 *  so two different products don't get the same opening sequence. */
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Pull the Nth distinct random model-style name for a given product. Cycles
 *  through the pool starting at a hashed offset; after the pool is exhausted,
 *  appends a roman-numeral suffix. */
function pickModelName(productId: string, index: number): string {
  const len = MODEL_NAME_POOL.length;
  const offset = hashStringToInt(productId) % len;
  const cycle = Math.floor((offset + index) / len);
  const base = MODEL_NAME_POOL[(offset + index) % len];
  if (cycle === 0) return base;
  const suffixes = ["II", "III", "IV", "V", "VI"];
  return `${base} ${suffixes[cycle - 1] ?? `${cycle + 1}`}`;
}

/** Ask Claude Haiku to invent a themed set of model names tuned to the
 *  product's aesthetic — Japanese-paper-lamp → Mochi/Sora/Hoshi/Shizuku;
 *  Mediterranean-terracotta → Sienna/Olea/Costa; industrial-edison →
 *  Forge/Anvil/Ember; etc. Returns up to `count` distinct names. Empty
 *  array on any failure (caller falls back to MODEL_NAME_POOL).
 *
 *  Text-only Haiku call: ~1-2s wall, ~$0.001 per product. Called ONCE per
 *  product per audit (results are reused across all Style/Model axes and
 *  all groups within those axes). */
async function generateThemedModelNames(
  productTitle: string,
  descriptionExcerpt: string,
  count: number,
): Promise<string[]> {
  if (!isClaudeConfigured()) return [];
  if (count <= 0) return [];
  const askFor = Math.max(count, 12); // ask for buffer so we always have enough after dedup
  const prompt =
    `You are naming product variants for a luxury Shopify lighting store.\n\n` +
    `Product title: "${productTitle.slice(0, 160)}"\n` +
    `Description excerpt: "${descriptionExcerpt.slice(0, 400)}"\n\n` +
    `Invent ${askFor} short evocative MODEL / STYLE names for this product's variants.\n\n` +
    `Rules:\n` +
    `- Each name is 1-3 words, max ~15 chars total\n` +
    `- Names must EVOKE the product's specific aesthetic / vibe / cultural origin. Examples by vibe:\n` +
    `  • Japanese paper / washi / minimalist → "Mochi", "Sora", "Hoshi", "Shizuku", "Daruma", "Hako", "Fude", "Yuki"\n` +
    `  • Mediterranean / terracotta / olive → "Sienna", "Olea", "Costa", "Bocca", "Limone", "Bianca", "Vigna", "Sole"\n` +
    `  • Industrial / edison / iron → "Forge", "Anvil", "Ember", "Rivet", "Briquet", "Cinder", "Iron Cap"\n` +
    `  • Scandinavian / pale wood / minimal → "Birk", "Hygge", "Fjord", "Lund", "Skog", "Naar"\n` +
    `  • Mid-century / brass / walnut → "Linden", "Marlow", "Aldridge", "Wren", "Tamsin"\n` +
    `- All ${askFor} names must feel like one cohesive collection family — pick ONE aesthetic and stay in it\n` +
    `- Each name MUST be DISTINCT from every other name\n` +
    `- No color words, no material words, no sizes, no numbers, no SKU codes\n` +
    `- Sound unique, cool, like a real designer-collection lineup\n\n` +
    `Return ONLY a JSON array of ${askFor} strings. No prefix, no explanation, no markdown fence.\n` +
    `Example output: ["Mochi", "Sora", "Hoshi", "Shizuku", "Daruma", "Hako", "Fude", "Yuki", "Akane", "Sumi", "Beni", "Yamabuki"]`;
  try {
    const result = await claudeJSON<unknown>({
      user: prompt,
      maxTokens: 600,
      temperature: 0.7,
    });
    if (!Array.isArray(result)) return [];
    const names = result
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.trim())
      .filter((n) => n.length > 0 && n.length <= 30);
    // Dedup case-insensitively, preserve first-seen casing.
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(n);
      if (unique.length >= count) break;
    }
    return unique;
  } catch (err) {
    console.warn(`[post-scrape-audit] themed names failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Tokens that indicate "this option value is a pack count, not a real style." */
const PACK_TOKEN_RE =
  /\b(\d+[\-\s]?pack|single[\-\s]?pack|double[\-\s]?pack|pcs|piece|个装|双个|单个|二个装|两个装)\b/i;

/** Axis NAMES that almost always mean a pack-count column. When an axis is
 *  literally called this, treat every value on the axis as pack-related even
 *  if the values themselves are bare ("Single", "Double"). */
const PACK_AXIS_NAME_RE = /^(quantity|qty|count|pack|packs|pcs|数量)$/i;

/** Axis names that mean "do you want the bulb included?" — we always include
 *  the bulb in the customer-facing listing, so this axis is never a real
 *  choice and gets stripped (variants with non-keep value hidden, then
 *  check 4 collapses the now-uniform axis). */
const BULB_AXIS_NAME_RE = /^(bulb\s*included?|with\s*bulb|bulb|with[\s-]?light\s*source|带光源|光源)$/i;

/** Spec / variant VALUE tokens that mean "the supplier didn't fill this in."
 *  Used to filter noise from extractedSpecs before description rendering and
 *  (in check 8) from the existing-specs purge pass. Hoisted to module scope
 *  so check 9 can reuse the same rule. */
const NOISE_VALUE_RE = /^(not specified|n\/?a|—|--|none|unspecified|unknown)$/i;

/** Bare pack-count value tokens that aren't caught by PACK_TOKEN_RE because
 *  they don't include the word "pack". Used in combination with axis-name
 *  detection OR sibling-value detection — never on their own (would false-
 *  positive on e.g. a "Single Bulb" finish). */
const BARE_SINGLE_RE = /^\s*(single|one|1|单|单只|单头)\s*$/i;
const BARE_MULTI_RE = /^\s*(double|triple|quadruple|quintuple|two|three|four|five|2|3|4|5|双|二|三|四|五|双只|三只|四只|五只|双头|三头|四头|五头)\s*$/i;

/** Tokens that say "this IS the 1-pack version (keep this one)". */
const SINGLE_PACK_RE = /\b(1[\-\s]?pack|single[\-\s]?pack|1\s*pcs?|单个装?|个$|^single$|^one$|^1$|^单$|^单只$|^单头$)\b/i;

function hasPackToken(s: string | null | undefined): boolean {
  if (!s) return false;
  return PACK_TOKEN_RE.test(s);
}

function isSinglePack(s: string | null | undefined): boolean {
  if (!s) return false;
  return SINGLE_PACK_RE.test(s);
}

/** Decide which axes (0/1/2) are pack-count axes:
 *  - Axis name matches PACK_AXIS_NAME_RE, OR
 *  - Values on the axis include BOTH a bare-single AND a bare-multi token
 *    (so "Single + Double" triggers, but a lone "Single Bulb" finish does not).
 */
function detectPackAxisIndices(
  optionNames: string[],
  variants: Array<{ option1: string | null; option2: string | null; option3: string | null; isHidden: boolean }>,
): number[] {
  const visible = variants.filter((v) => !v.isHidden);
  const out: number[] = [];
  for (let i = 0; i < Math.min(optionNames.length, 3); i++) {
    if (PACK_AXIS_NAME_RE.test(optionNames[i].trim())) {
      out.push(i);
      continue;
    }
    const key = OPT_KEYS[i];
    let sawSingle = false;
    let sawMulti = false;
    for (const v of visible) {
      const val = v[key];
      if (!val) continue;
      if (BARE_SINGLE_RE.test(val)) sawSingle = true;
      else if (BARE_MULTI_RE.test(val)) sawMulti = true;
    }
    if (sawSingle && sawMulti) out.push(i);
  }
  return out;
}

/** Match a size token within an option value, e.g. "60cm", "1.5m", "23 in". */
const SIZE_TOKEN_RE = /(\d+(?:\.\d+)?)\s*(cm|mm|m|in|inch|inches|ft|"|')/gi;
const HAS_SIZE_RE = /\d+(?:\.\d+)?\s*(cm|mm|m|in|inch|inches|ft|"|')/i;

/** Whole-value dimensional pattern: "<n> × <n> [× <n>] <unit>" — when matched,
 *  the trailing unit applies to ALL preceding numbers. Catches the user's
 *  "50 × 6 cm" case where the existing per-token regex would only convert the
 *  "6 cm" portion and leave "50" unitless. */
const DIMENSIONAL_RE =
  /^\s*(\d+(?:\.\d+)?)(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?(?:\s*[×x*]\s*(\d+(?:\.\d+)?))?\s*(cm|mm|m|in|inch|inches|ft)\s*$/i;

function looksLikeSizeValue(s: string | null | undefined): boolean {
  if (!s) return false;
  return HAS_SIZE_RE.test(s);
}

/** Convert a single numeric+unit pair into rounded-to-0.5" inches. Returns
 *  null if the unit is already imperial or unknown. */
function toInchesString(n: number, unit: string): string | null {
  const u = unit.toLowerCase();
  if (u === "in" || u === "inch" || u === "inches" || u === '"') return null;
  if (u === "ft" || u === "'") return null;
  let inches: number;
  if (u === "mm") inches = n / 25.4;
  else if (u === "cm") inches = n / 2.54;
  else if (u === "m") inches = n / 0.0254;
  else return null;
  const rounded = Math.round(inches * 2) / 2;
  return `${rounded.toFixed(1).replace(/\.0$/, "")}"`;
}

/** Heuristic legacy-damage fix. Catches values like "50 × 2.5\"" that were
 *  produced by an EARLIER audit's incomplete conversion ("50 × 6 cm" got
 *  half-converted, the "cm" marker was lost on the leading number). If we
 *  see a value where the FIRST number is unitless AND > 30 AND the SECOND
 *  is in inches, assume the first was originally cm and convert it. The
 *  >30 threshold avoids false positives on legit "5" × 2"" small parts. */
const LEGACY_HALF_CONVERTED_RE = /^\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*"?\s*$/;
function repairLegacyHalfConverted(value: string): { converted: string; changed: boolean } {
  // Two shapes to detect:
  //   "50 × 2.5\""  → both numbers; first unitless, second has " trailing
  //   "50 × 2.5"    → both numbers; same (rare but possible)
  // The simplest detector: split on × / x, check that there are exactly 2
  // numeric pieces, and the second contains an inch marker.
  const m = value.match(/^\s*(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)\s*("|in|inch|inches)?\s*$/i);
  if (!m) return { converted: value, changed: false };
  const [, a, b, unit] = m;
  if (!unit) return { converted: value, changed: false };
  const nA = parseFloat(a);
  const nB = parseFloat(b);
  if (!Number.isFinite(nA) || !Number.isFinite(nB)) return { converted: value, changed: false };
  // Only repair if the leading number is suspiciously large for inches.
  // Wall-lamp dimensions over 30" are rare; lamp lengths in cm commonly
  // hit 40-100. 30 is a safe-ish threshold; below it we don't touch.
  if (nA <= 30) return { converted: value, changed: false };
  const repaired = toInchesString(nA, "cm");
  if (repaired === null) return { converted: value, changed: false };
  return { converted: `${repaired} × ${nB}"`, changed: true };
}

function convertCmInValueToInches(value: string): { converted: string; changed: boolean } {
  // Pass 0: legacy-damage repair (see comment on repairLegacyHalfConverted).
  // Runs FIRST because the input shape ("50 × 2.5\"") would otherwise be
  // skipped by the dimensional regex (no trailing unit).
  const legacy = repairLegacyHalfConverted(value);
  if (legacy.changed) return legacy;

  // Pass 1: whole-value dimensional pattern. Matches "50 × 6 cm" (and 1- or
  // 3-number variants) where the unit at the END applies to every number.
  // If matched, convert all numbers using the shared unit and return early.
  const dimMatch = value.match(DIMENSIONAL_RE);
  if (dimMatch) {
    const [, a, b, c, unit] = dimMatch;
    const parts: string[] = [];
    let dimChanged = false;
    for (const numStr of [a, b, c]) {
      if (!numStr) continue;
      const n = parseFloat(numStr);
      if (!Number.isFinite(n)) {
        parts.push(numStr);
        continue;
      }
      const inches = toInchesString(n, unit);
      if (inches === null) {
        parts.push(`${numStr}${unit}`); // imperial pass-through
      } else {
        parts.push(inches);
        dimChanged = true;
      }
    }
    if (dimChanged) return { converted: parts.join(" × "), changed: true };
    // Unit was imperial (no conversion needed). Fall through to Pass 2 in
    // case there are leftover non-matching tokens.
  }

  // Pass 2: existing per-token regex — converts every "<n><unit>" in the
  // string independently. Used for free-form values like "Length 60cm
  // width 6cm" that don't match the strict dimensional shape.
  let changed = false;
  const converted = value.replace(SIZE_TOKEN_RE, (_match, num: string, unit: string) => {
    const n = parseFloat(num);
    if (!Number.isFinite(n)) return _match;
    const inches = toInchesString(n, unit);
    if (inches === null) return _match;
    changed = true;
    return inches;
  });
  return { converted, changed };
}

function parseOptionNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // Fall through
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function publicSupabaseUrlFromPath(storagePath: string): string {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
  // Cheap construct (avoids importing the supabase client just to build a URL).
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${storagePath}`;
}

async function log(
  jobId: string | null,
  level: "info" | "warn" | "error",
  msg: string,
): Promise<void> {
  // Local console + (if scrape job) DB log.
  console.log(`[post-scrape-audit] ${level}: ${msg}`);
  if (jobId) {
    try {
      await addJobLog(jobId, level, `[audit] ${msg}`);
    } catch {
      // Don't crash the audit on a logging failure.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Product loader (shared across checks)
// ─────────────────────────────────────────────────────────────────────────────

async function loadProductFull(productId: string) {
  return prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { orderBy: { position: "asc" } },
      images: { orderBy: { position: "asc" } },
    },
  });
}

type LoadedProduct = NonNullable<Awaited<ReturnType<typeof loadProductFull>>>;
type LoadedVariant = LoadedProduct["variants"][number];
type LoadedImage = LoadedProduct["images"][number];

// ─────────────────────────────────────────────────────────────────────────────
// Check 1: Waffle SKU rename (vision-driven)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISION_CALLS_PER_PRODUCT = 30;

async function check1WaffleSku(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "waffle-sku-rename",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  const visible = product.variants.filter((v) => !v.isHidden);
  const imagesById = new Map(product.images.map((i) => [i.id, i]));
  const optionNames = parseOptionNames(product.optionNames);

  // ── PASS 0: Style/Model axes — random pool names, no vision ──────────────
  // For axes whose label is Style/Model/Type/Series/Item/Design/Collection,
  // skip vision entirely. Group visible variants by current value on this
  // axis; each group gets one random model-pool name UNLESS the group is
  // collision-damaged (multiple variants share this axis value AND also
  // share their OTHER axis values), in which case each variant gets its
  // own name. This fixes both the "JK-1 supplier SKU" rename case AND the
  // legacy collision damage from earlier vision-only runs.
  const candidateStyleAxisIndices: number[] = [];
  for (let i = 0; i < Math.min(optionNames.length, 3); i++) {
    if (STYLE_AXIS_NAME_RE.test(optionNames[i].trim())) candidateStyleAxisIndices.push(i);
  }

  // Skip a Style/Model axis when it already has stable, themed-looking
  // values. Detection: an axis "needs rename" if (a) any value matches the
  // waffle-SKU regex, OR (b) any value is from the static MODEL_NAME_POOL
  // (meaning an earlier audit pre-themed-names pass assigned it), OR (c)
  // collision damage exists (multiple variants share the axis value AND
  // also share other-axis values). Otherwise the axis is already-themed
  // and we leave it alone — prevents re-running the audit from re-rolling
  // the names every time.
  const staticPoolLower = new Set(MODEL_NAME_POOL.map((n) => n.toLowerCase()));
  const axisNeedsRename = (axisIdx: number): boolean => {
    const axisKey = OPT_KEYS[axisIdx];
    const values = visible
      .map((v) => v[axisKey])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (values.length === 0) return false;
    if (values.some((v) => isWaffleSkuValue(v))) return true;
    // Static-pool check uses the FIRST word (so "Aurora II" still matches "Aurora").
    if (values.some((v) => staticPoolLower.has(v.trim().split(/\s+/)[0].toLowerCase()))) return true;
    // Collision check: same axis value with shared other-axis values.
    const byValue = new Map<string, LoadedVariant[]>();
    for (const v of visible) {
      const k = v[axisKey] ?? "";
      if (!byValue.has(k)) byValue.set(k, []);
      byValue.get(k)!.push(v);
    }
    for (const [, vars] of byValue.entries()) {
      if (vars.length < 2) continue;
      const otherKey = (v: LoadedVariant): string =>
        OPT_KEYS.filter((k) => k !== axisKey).map((k) => v[k] ?? "").join("||");
      const byOther = new Map<string, LoadedVariant[]>();
      for (const v of vars) {
        const k = otherKey(v);
        if (!byOther.has(k)) byOther.set(k, []);
        byOther.get(k)!.push(v);
      }
      if ([...byOther.values()].some((arr) => arr.length > 1)) return true;
    }
    return false;
  };
  const styleAxisIndices = candidateStyleAxisIndices.filter(axisNeedsRename);

  // Pre-pass: estimate how many distinct names we'll need across all Style/
  // Model axes, then ask Claude ONCE for a themed name pool tuned to this
  // product's aesthetic. Falls back to the static MODEL_NAME_POOL on any
  // failure (preserves previous behavior).
  let themedNames: string[] = [];
  let themedSource = "static-pool";
  if (styleAxisIndices.length > 0) {
    // Upper bound on names needed = sum of "distinct groups per axis" across
    // every style axis. Cheap to compute; over-estimating is fine.
    let totalNeeded = 0;
    for (const axisIdx of styleAxisIndices) {
      const axisKey = OPT_KEYS[axisIdx];
      const valueSet = new Set<string>();
      for (const v of visible) {
        valueSet.add(v[axisKey] ?? "");
      }
      // Worst case: every variant is its own group (collision-damaged path).
      totalNeeded += Math.max(visible.length, valueSet.size);
    }
    if (totalNeeded > 0) {
      const descExcerpt = (product.descriptionHtml ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      themedNames = await generateThemedModelNames(product.title, descExcerpt, Math.min(totalNeeded + 4, 24));
      if (themedNames.length > 0) {
        themedSource = "themed";
        await log(jobId, "info", `check 1 themed names: got ${themedNames.length} (${themedNames.slice(0, 6).join(", ")}${themedNames.length > 6 ? "…" : ""})`);
      }
    }
  }
  // Shared pick: themed first, fall back to static pool with a cycle offset
  // so we don't repeat names already taken from the themed pool.
  const pickName = (groupIdx: number): string => {
    if (themedNames[groupIdx]) return themedNames[groupIdx];
    return pickModelName(product.id, groupIdx - themedNames.length);
  };

  const styleRenamePairs: string[] = []; // for the log
  let globalGroupIdx = 0; // monotonic counter across all style axes so picks don't collide
  for (const axisIdx of styleAxisIndices) {
    const axisKey = OPT_KEYS[axisIdx];
    // Group visible variants by current value on this axis.
    const byValue = new Map<string, LoadedVariant[]>();
    for (const v of visible) {
      const k = v[axisKey] ?? "";
      if (!byValue.has(k)) byValue.set(k, []);
      byValue.get(k)!.push(v);
    }
    // For each value group, decide if it's collision-damaged:
    //   - multiple variants share this axis value
    //   - AND at least one PAIR within the group also shares the other-axis
    //     values (so they'd be indistinguishable in Shopify)
    // If damaged, split each variant into its own group.
    const otherKey = (v: LoadedVariant): string =>
      OPT_KEYS.filter((k) => k !== axisKey).map((k) => v[k] ?? "").join("||");
    const finalGroups: LoadedVariant[][] = [];
    for (const [, vars] of byValue.entries()) {
      if (vars.length === 1) {
        finalGroups.push(vars);
        continue;
      }
      const byOther = new Map<string, LoadedVariant[]>();
      for (const v of vars) {
        const k = otherKey(v);
        if (!byOther.has(k)) byOther.set(k, []);
        byOther.get(k)!.push(v);
      }
      const hasInternalDups = [...byOther.values()].some((arr) => arr.length > 1);
      if (hasInternalDups) {
        for (const v of vars) finalGroups.push([v]); // split per-variant
      } else {
        finalGroups.push(vars); // legitimate siblings — keep grouped
      }
    }
    // Assign distinct themed names (themed pool first, static fallback).
    const updates: Promise<unknown>[] = [];
    for (let i = 0; i < finalGroups.length; i++) {
      const name = pickName(globalGroupIdx);
      globalGroupIdx++;
      for (const v of finalGroups[i]) {
        if (v[axisKey] === name) continue;
        if (styleRenamePairs.length < 5) {
          styleRenamePairs.push(`"${v[axisKey] ?? ""}" → "${name}"`);
        }
        updates.push(
          prisma.variant.update({
            where: { id: v.id },
            data: { [axisKey]: name },
          }),
        );
        result.fixed++;
      }
    }
    await Promise.all(updates);
    if (updates.length > 0) {
      result.details.push(
        `Style/Model axis "${optionNames[axisIdx]}" (${themedSource}): ${finalGroups.length} group(s) → ${updates.length} variant(s) renamed (${styleRenamePairs.join(", ")}${styleRenamePairs.length >= 5 ? "…" : ""})`,
      );
    }
  }

  // Recompute titles for any variants we just touched in PASS 0.
  if (styleAxisIndices.length > 0) {
    const fresh = await prisma.variant.findMany({
      where: { id: { in: visible.map((v) => v.id) } },
      select: { id: true, option1: true, option2: true, option3: true, title: true },
    });
    await Promise.all(
      fresh.map((v) => {
        const newTitle =
          [v.option1, v.option2, v.option3]
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .join(" / ") || v.title;
        if (newTitle === v.title) return Promise.resolve();
        return prisma.variant.update({ where: { id: v.id }, data: { title: newTitle } });
      }),
    );
  }

  // ── PASS 1: Vision-driven waffle rename for NON-style axes ───────────────

  if (!isClaudeConfigured()) {
    // Style axes already processed above; remaining work needs Claude.
    if (result.fixed === 0) result.details.push("ANTHROPIC_API_KEY not set — skipping vision pass");
    return result;
  }

  // For each visible variant, find waffle option values across all 3 axes —
  // BUT only on axes that aren't already in styleAxisIndices.
  type Target = {
    variant: LoadedVariant;
    axisKey: OptKey;
    oldValue: string;
  };
  const styleAxisKeys = new Set<OptKey>(styleAxisIndices.map((i) => OPT_KEYS[i]));
  // Reload visibles to pick up the PASS 0 writes.
  const visibleAfterPass0 = await prisma.variant.findMany({
    where: { productId: product.id, isHidden: false },
    orderBy: { position: "asc" },
  });
  const targets: Target[] = [];
  for (const v of visibleAfterPass0) {
    for (const key of OPT_KEYS) {
      if (styleAxisKeys.has(key)) continue; // already handled in PASS 0
      const val = v[key];
      if (isWaffleSkuValue(val)) {
        targets.push({ variant: v as LoadedVariant, axisKey: key, oldValue: val as string });
      }
    }
  }

  result.checked += targets.length;
  if (targets.length === 0) return result;

  if (targets.length > MAX_VISION_CALLS_PER_PRODUCT) {
    result.details.push(
      `Capped at ${MAX_VISION_CALLS_PER_PRODUCT} vision calls (would have been ${targets.length})`,
    );
    targets.length = MAX_VISION_CALLS_PER_PRODUCT;
  }

  // Dedup by oldValue — multiple variants might share the same waffle SKU on
  // the same axis; one vision call decides the rename for all of them.
  const renamesByOld = new Map<string, string>(); // oldValue -> newValue
  const distinctOlds = new Map<string, Target>(); // oldValue -> first target
  for (const t of targets) {
    if (!distinctOlds.has(t.oldValue)) distinctOlds.set(t.oldValue, t);
  }

  // Reusable per-target vision call. `forbidden` is the list of names the
  // model must NOT return (used during collision retry — keeps the model from
  // returning the same name as a sibling that's already been named).
  async function visionNameForTarget(
    t: Target,
    oldValue: string,
    forbidden: string[],
  ): Promise<{ name: string } | { error: string }> {
    const refImg =
      (t.variant.featuredImageId
        ? imagesById.get(t.variant.featuredImageId)
        : undefined) ??
      product.images.find((i) => i.variantId === t.variant.id) ??
      null;
    if (!refImg) return { error: "no reference image" };
    const refUrl = refImg.storagePath
      ? publicSupabaseUrlFromPath(refImg.storagePath)
      : refImg.sourceUrl;
    try {
      // 1688's reference images are often 5-7 MB high-res JPEGs — past the
      // Anthropic 5 MB image limit. Download, resize via Sharp to a sane
      // catalog-thumbnail size, then send inline as base64.
      const imgRes = await fetch(refUrl);
      if (!imgRes.ok) return { error: `failed to download ref image (HTTP ${imgRes.status})` };
      const rawBuf = Buffer.from(await imgRes.arrayBuffer());
      const resized = await sharp(rawBuf)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;

      const forbiddenClause =
        forbidden.length > 0
          ? ` IMPORTANT: sibling variants of the same product have already been named ${forbidden.map((n) => `"${n}"`).join(", ")}. Your name MUST be different from those. Look closely for a distinguishing detail (size, accent color, finish, length, shape, number of heads, etc.) that sets THIS specific variant apart from the siblings, and name based on that distinction.`
          : "";
      const prompt =
        `You are looking at one variant of a product titled: "${product.title.slice(0, 100)}". ` +
        `This variant is currently labeled with the SKU code "${oldValue}", which is not customer-friendly. ` +
        `Look at the image and return ONE short (2-4 words) descriptive name for THIS variant's STYLE/SHADE/FINISH/SHAPE — the visible distinguishing feature. ` +
        `No brand names, no specs, no units. Examples of good names: "Brass Globe", "Classic Drum", "Sleek Black Rod", "Reeded Cream", "Frosted Cylinder", "Walnut Pleat".${forbiddenClause} ` +
        `Return ONLY the name. No quotes, no prefix, no explanation, no period.`;
      const raw = await claudeVision({
        imageUrl: dataUri,
        prompt,
        maxTokens: 80,
        temperature: forbidden.length > 0 ? 0.45 : 0.2,
      });
      const cleaned = raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\.+$/g, "")
        .split(/\r?\n/)[0]
        .trim();
      if (!cleaned || cleaned.length > 60 || cleaned.toLowerCase() === oldValue.toLowerCase()) {
        return { error: `Claude returned unusable name "${cleaned}"` };
      }
      return { name: cleaned };
    } catch (err) {
      return { error: `vision call failed — ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // First pass: one vision call per distinct oldValue (no forbidden names yet).
  for (const [oldValue, t] of distinctOlds.entries()) {
    const r = await visionNameForTarget(t, oldValue, []);
    if ("error" in r) {
      result.flagged++;
      result.details.push(`"${oldValue}": ${r.error} — left as-is`);
      continue;
    }
    renamesByOld.set(oldValue, r.name);
  }

  if (renamesByOld.size === 0) return result;

  // Collision-resolution pass: per axis, find newName values that ended up
  // mapping to 2+ distinct oldValues. For each collision keep oldValue[0]'s
  // name as-is; for oldValues[1..N] retry one vision call with the colliding
  // names listed as `forbidden`. Fall back to a positional suffix
  // ("Original Name 2", "Original Name 3", …) if the retry still collides.
  function collisionMapByAxis(): Map<OptKey, Map<string, string[]>> {
    const out = new Map<OptKey, Map<string, string[]>>();
    for (const t of targets) {
      const newName = renamesByOld.get(t.oldValue);
      if (!newName) continue;
      let axisMap = out.get(t.axisKey);
      if (!axisMap) { axisMap = new Map(); out.set(t.axisKey, axisMap); }
      const key = newName.toLowerCase();
      let list = axisMap.get(key);
      if (!list) { list = []; axisMap.set(key, list); }
      if (!list.includes(t.oldValue)) list.push(t.oldValue);
    }
    return out;
  }

  let collisionRetries = 0;
  let collisionSuffixes = 0;
  const initialCollisions = collisionMapByAxis();
  for (const [, axisMap] of initialCollisions.entries()) {
    for (const [, oldValues] of axisMap.entries()) {
      if (oldValues.length < 2) continue;
      // Keep oldValues[0]'s name. Process [1..] in order.
      const keptName = renamesByOld.get(oldValues[0])!;
      const forbidden = [keptName];
      for (let i = 1; i < oldValues.length; i++) {
        const oldValue = oldValues[i];
        const t = distinctOlds.get(oldValue);
        if (!t) continue;
        const r = await visionNameForTarget(t, oldValue, forbidden);
        let chosen: string;
        if ("name" in r && !forbidden.some((f) => f.toLowerCase() === r.name.toLowerCase())) {
          chosen = r.name;
          collisionRetries++;
        } else {
          // Positional suffix fallback. Number from 2 (kept = 1).
          chosen = `${keptName} ${i + 1}`;
          collisionSuffixes++;
        }
        renamesByOld.set(oldValue, chosen);
        forbidden.push(chosen);
      }
    }
  }
  if (collisionRetries + collisionSuffixes > 0) {
    result.details.push(
      `collision-resolved ${collisionRetries + collisionSuffixes} rename(s) (${collisionRetries} re-named via Claude, ${collisionSuffixes} suffixed)`,
    );
  }

  // Apply the renames in one transaction grouped by axisKey + oldValue.
  // Re-iterate ALL targets to pick up duplicates that share the same oldValue.
  const updates: Promise<unknown>[] = [];
  for (const t of targets) {
    const newVal = renamesByOld.get(t.oldValue);
    if (!newVal) continue;
    updates.push(
      prisma.variant.update({
        where: { id: t.variant.id },
        data: { [t.axisKey]: newVal },
      }),
    );
    result.fixed++;
  }
  await Promise.all(updates);

  // Recompute titles for renamed variants (title is option1/option2/option3 joined).
  // Pull the updated variants and stamp `title` field afresh.
  const renamedIds = Array.from(
    new Set(
      targets
        .filter((t) => renamesByOld.has(t.oldValue))
        .map((t) => t.variant.id),
    ),
  );
  if (renamedIds.length > 0) {
    const fresh = await prisma.variant.findMany({
      where: { id: { in: renamedIds } },
      select: { id: true, option1: true, option2: true, option3: true, title: true },
    });
    await Promise.all(
      fresh.map((v) => {
        const newTitle =
          [v.option1, v.option2, v.option3]
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .join(" / ") || v.title;
        if (newTitle === v.title) return Promise.resolve();
        return prisma.variant.update({ where: { id: v.id }, data: { title: newTitle } });
      }),
    );
  }

  const sample = Array.from(renamesByOld.entries())
    .slice(0, 5)
    .map(([o, n]) => `"${o}" → "${n}"`)
    .join(", ");
  result.details.push(
    `Renamed ${result.fixed} variant value(s) across ${renamesByOld.size} unique waffle SKU(s): ${sample}` +
      (renamesByOld.size > 5 ? "…" : ""),
  );
  await log(jobId, "info", `check 1 waffle-sku: ${result.fixed} renamed (${renamesByOld.size} unique)`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 2: Variants without source images (link fix)
// ─────────────────────────────────────────────────────────────────────────────

async function check2VariantsWithoutImages(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "variants-without-images",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  const visible = product.variants.filter((v) => !v.isHidden);
  const imagesById = new Map(product.images.map((i) => [i.id, i]));

  // Unlinked = no featuredImageId AND no productImage with variantId=variant.id
  const unlinked = visible.filter((v) => {
    const hasFeatured = !!v.featuredImageId && imagesById.has(v.featuredImageId);
    if (hasFeatured) return false;
    const hasVariantLinked = product.images.some((i) => i.variantId === v.id);
    return !hasVariantLinked;
  });
  result.checked = unlinked.length;
  if (unlinked.length === 0) return result;

  // Candidate pool: source images (imageType null OR "source") with no variantId set,
  // ordered by position. Each one gets consumed at most once.
  const candidates = product.images.filter(
    (i) =>
      (i.imageType === null || i.imageType === "source") &&
      i.variantId === null,
  );
  let nextIdx = 0;

  for (const v of unlinked) {
    const candidate = candidates[nextIdx];
    if (!candidate) {
      // Out of candidates — fall back to the lowest-position source image
      // (even if it's already linked to another variant). Better SOMETHING
      // than nothing for the hero pipeline.
      const fallback =
        product.images.find(
          (i) => i.imageType === null || i.imageType === "source",
        ) ?? null;
      if (!fallback) {
        result.flagged++;
        result.details.push(
          `variant "${v.title.slice(0, 40)}": no source image at all — leave alone`,
        );
        continue;
      }
      await prisma.variant.update({
        where: { id: v.id },
        data: { featuredImageId: fallback.id },
      });
      result.fixed++;
      continue;
    }
    nextIdx++;
    await prisma.$transaction([
      prisma.variant.update({
        where: { id: v.id },
        data: { featuredImageId: candidate.id },
      }),
      prisma.productImage.update({
        where: { id: candidate.id },
        data: { variantId: v.id },
      }),
    ]);
    result.fixed++;
  }
  result.details.push(
    `linked ${result.fixed} variant(s) to source images${result.flagged > 0 ? ` (${result.flagged} unresolvable)` : ""}`,
  );
  await log(jobId, "info", `check 2 unlinked-variants: ${result.fixed} linked, ${result.flagged} unresolvable`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3: Pack-axis remnants (hide multi-pack variants)
// ─────────────────────────────────────────────────────────────────────────────

async function check3PackAxisRemnants(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "pack-axis-remnants",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  const visible = product.variants.filter((v) => !v.isHidden);
  result.checked = visible.length;
  if (visible.length === 0) return result;

  const optionNames = parseOptionNames(product.optionNames);

  // Two ways a variant becomes a pack-axis offender:
  //   (1) A specific option value matches PACK_TOKEN_RE (e.g. "double pack",
  //       "双个装") — caught at the value level on any axis.
  //   (2) The variant has a value on an axis we've identified as a pack-axis
  //       (axis named "Quantity" / "Pack" / "Pcs" etc., OR an axis whose
  //       values mix bare "Single"/"Double"-style tokens).
  // The single-keeper logic stays the same: keep variants whose pack-axis
  // value is single-like; hide the rest.
  const packAxisIndices = detectPackAxisIndices(optionNames, visible);
  const packAxisKeys = new Set<OptKey>(packAxisIndices.map((i) => OPT_KEYS[i]));

  const offenders: LoadedVariant[] = [];
  for (const v of visible) {
    let isOffender = false;
    for (const key of OPT_KEYS) {
      const val = v[key];
      if (!val) continue;
      if (hasPackToken(val)) { isOffender = true; break; }
      if (packAxisKeys.has(key)) { isOffender = true; break; }
    }
    if (isOffender) offenders.push(v);
  }
  if (offenders.length === 0) return result;

  // Decide who to keep: a variant survives if EITHER its pack-axis value
  // matches SINGLE_PACK_RE / BARE_SINGLE_RE, OR (if no single-like values
  // exist) it is the lowest-position offender.
  const isSingleLike = (v: LoadedVariant): boolean => {
    for (const key of OPT_KEYS) {
      const val = v[key];
      if (!val) continue;
      if (packAxisKeys.has(key)) {
        // On a known pack axis, bare "single"/"one"/"1"/"单" all count.
        if (BARE_SINGLE_RE.test(val) || isSinglePack(val)) return true;
      } else if (isSinglePack(val)) {
        return true;
      }
    }
    return false;
  };
  const singleKeepers = offenders.filter(isSingleLike);
  const toHide: LoadedVariant[] = [];
  if (singleKeepers.length > 0) {
    for (const v of offenders) {
      if (!singleKeepers.includes(v)) toHide.push(v);
    }
  } else {
    // No "single" candidate exists — keep the lowest-position offender as
    // the representative; hide the rest.
    const sorted = [...offenders].sort((a, b) => a.position - b.position);
    for (let i = 1; i < sorted.length; i++) toHide.push(sorted[i]);
  }

  if (toHide.length === 0) return result;

  await prisma.variant.updateMany({
    where: { id: { in: toHide.map((v) => v.id) } },
    data: { isHidden: true },
  });
  result.fixed = toHide.length;

  const axisLabels =
    packAxisIndices.length > 0
      ? ` (pack axis: ${packAxisIndices.map((i) => `"${optionNames[i] ?? OPT_KEYS[i]}"`).join(", ")})`
      : "";
  result.details.push(
    `hid ${toHide.length} variant(s) with pack tokens${axisLabels} (kept ${singleKeepers.length > 0 ? singleKeepers.length : 1} representative single-pack variant${singleKeepers.length === 1 ? "" : "s"})`,
  );
  await log(jobId, "info", `check 3 pack-axis: hid ${toHide.length}${axisLabels}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3a: "Bulb Included" axis — we always include the bulb in the
// customer-facing listing, so this axis is never a real choice. Find any axis
// whose NAME matches BULB_AXIS_NAME_RE; on it:
//   1. Pick a keepValue (prefer "Yes" / "With Bulb" / "Included" / anything
//      affirmative; else the most common value).
//   2. Hide variants whose value is not the keep value.
//   3. Drop the bulb axis from `Product.optionNames`, splice out the axis
//      slot on every visible variant, shift higher axes down, re-derive titles.
//      We do this here (not in check 4) because check 4 refuses to drop the
//      only remaining axis — and "Bulb Included" being the only axis is the
//      common case for fan-light products.
// ─────────────────────────────────────────────────────────────────────────────

const BULB_AFFIRMATIVE_RE = /^(yes|y|with|included?|含|带|有|true|on)$/i;

async function check3aBulbIncludedAxis(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "bulb-included-axis",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  const optionNames = parseOptionNames(product.optionNames);
  const bulbAxisIndex = optionNames.findIndex((n) => BULB_AXIS_NAME_RE.test(n.trim()));
  if (bulbAxisIndex < 0) return result;

  const visible = product.variants.filter((v) => !v.isHidden);
  result.checked = visible.length;
  if (visible.length === 0) return result;

  const axisKey: OptKey = OPT_KEYS[bulbAxisIndex];
  const valueCounts = new Map<string, number>();
  for (const v of visible) {
    const val = v[axisKey];
    if (typeof val === "string" && val.trim().length > 0) {
      const norm = val.trim();
      valueCounts.set(norm, (valueCounts.get(norm) ?? 0) + 1);
    }
  }

  // 1. Determine keepValue. If every visible value is empty/null we still
  //    want to strip the axis; no hide step in that case.
  let keepValue: string | null = null;
  let toHide: LoadedVariant[] = [];
  if (valueCounts.size > 0) {
    const affirmative = Array.from(valueCounts.keys()).filter((v) =>
      BULB_AFFIRMATIVE_RE.test(v),
    );
    keepValue =
      affirmative.length > 0
        ? affirmative[0]
        : Array.from(valueCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    toHide = visible.filter((v) => {
      const val = v[axisKey];
      return typeof val === "string" && val.trim() !== keepValue;
    });
    // Safety: don't hide ALL visible variants.
    if (toHide.length === visible.length) {
      result.flagged = 1;
      result.details.push(
        `"${optionNames[bulbAxisIndex]}" axis has no affirmative value — manual review needed`,
      );
      await log(
        jobId,
        "warn",
        `check 3a bulb-axis: no affirmative value on "${optionNames[bulbAxisIndex]}" — flagged`,
      );
      return result;
    }
  }

  // 2. Hide non-keep variants.
  if (toHide.length > 0) {
    await prisma.variant.updateMany({
      where: { id: { in: toHide.map((v) => v.id) } },
      data: { isHidden: true },
    });
  }

  // 3. Splice out the bulb axis on survivors (reload to pick up the hides).
  const survivors = await prisma.variant.findMany({
    where: { productId: product.id, isHidden: false },
    select: { id: true, option1: true, option2: true, option3: true },
  });
  const updates: Promise<unknown>[] = [];
  for (const v of survivors) {
    const opts: (string | null)[] = [v.option1, v.option2, v.option3];
    opts.splice(bulbAxisIndex, 1);
    opts.push(null);
    const [o1, o2, o3] = opts;
    const newTitle =
      [o1, o2, o3]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .join(" / ") || "Default Title";
    updates.push(
      prisma.variant.update({
        where: { id: v.id },
        data: { option1: o1, option2: o2, option3: o3, title: newTitle },
      }),
    );
  }
  // 4. Update Product.optionNames to drop the axis.
  const newNames = [...optionNames];
  newNames.splice(bulbAxisIndex, 1);
  updates.push(
    prisma.product.update({
      where: { id: product.id },
      data: { optionNames: JSON.stringify(newNames) },
    }),
  );
  await Promise.all(updates);

  result.fixed = toHide.length + 1; // hides + axis drop
  const hideClause = toHide.length > 0 ? `hid ${toHide.length} non-keep variant(s), ` : "";
  result.details.push(
    `${hideClause}dropped "${optionNames[bulbAxisIndex]}" axis (kept value "${keepValue ?? "—"}")`,
  );
  await log(
    jobId,
    "info",
    `check 3a bulb-axis: dropped "${optionNames[bulbAxisIndex]}" (kept "${keepValue ?? "—"}"), ${hideClause}newOptionNames=${JSON.stringify(newNames)}`,
  );
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4: Empty/redundant axes (drop the axis from optionNames)
// ─────────────────────────────────────────────────────────────────────────────

async function check4EmptyAxes(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "empty-axes",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  const optionNames = parseOptionNames(product.optionNames);
  result.checked = optionNames.length;
  if (optionNames.length === 0) return result;

  // Reload variants to pick up any hides from check 3.
  const visible = await prisma.variant.findMany({
    where: { productId: product.id, isHidden: false },
    select: { id: true, option1: true, option2: true, option3: true },
  });
  if (visible.length === 0) return result;

  // Walk from the last axis down so splicing indexes stays valid. Drop ANY
  // axis where all visible variants share the same value (or all are empty
  // — special case of "all share null"). A uniform axis provides no
  // differentiation; keeping it just bloats the variant matrix and the
  // Shopify product options. EXCEPT: don't drop if it would leave 0 axes
  // (single-variant-no-options products keep their lone axis untouched —
  // their lone value flows into the title/SKU naturally).
  const droppedNames: string[] = [];
  const droppedValues: Record<string, string | null> = {};
  const remainingNames = [...optionNames];
  let visibleVariantsLocal = visible;
  for (let axisIndex = optionNames.length - 1; axisIndex >= 0; axisIndex--) {
    if (remainingNames.length <= 1) break; // never drop the only axis
    const key = OPT_KEYS[axisIndex];
    const uniqueValues = new Set<string | null>();
    for (const v of visibleVariantsLocal) {
      const val = v[key];
      const normalised =
        val === null || (typeof val === "string" && val.trim() === "")
          ? null
          : (val as string).trim();
      uniqueValues.add(normalised);
    }
    if (uniqueValues.size > 1) continue; // not uniform
    const onlyValue = uniqueValues.values().next().value as string | null;
    droppedNames.push(remainingNames[axisIndex]);
    droppedValues[remainingNames[axisIndex]] = onlyValue;
    remainingNames.splice(axisIndex, 1);
    // Null out the axis value on all variants AND shift higher axes down a
    // slot, mirroring the drop-option-axis API behavior. Easier to do in one
    // pass after the loop — collect the indexes to drop and apply at end.
  }
  if (droppedNames.length === 0) return result;

  // Recompute every visible variant's option1/option2/option3 by splicing out
  // the dropped axes. droppedIndexes is the list of original-axis-indexes we
  // removed (sorted desc since we walked desc above).
  const droppedIndexes: number[] = [];
  for (let i = optionNames.length - 1; i >= 0; i--) {
    if (droppedNames.includes(optionNames[i])) droppedIndexes.push(i);
  }

  const updates: Promise<unknown>[] = [];
  for (const v of visibleVariantsLocal) {
    const opts: (string | null)[] = [v.option1, v.option2, v.option3];
    for (const idx of droppedIndexes) {
      opts.splice(idx, 1);
      opts.push(null); // pad to length 3
    }
    const [o1, o2, o3] = opts;
    const newTitle =
      [o1, o2, o3]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .join(" / ") || (o1 ?? "Default Title");
    updates.push(
      prisma.variant.update({
        where: { id: v.id },
        data: { option1: o1, option2: o2, option3: o3, title: newTitle },
      }),
    );
  }
  updates.push(
    prisma.product.update({
      where: { id: product.id },
      data: { optionNames: JSON.stringify(remainingNames) },
    }),
  );
  await Promise.all(updates);
  result.fixed = droppedNames.length;
  const labelDetails = droppedNames
    .map((n) => `"${n}"${droppedValues[n] ? ` (uniform "${droppedValues[n]}")` : " (empty)"}`)
    .join(", ");
  result.details.push(`dropped redundant axis(es): ${labelDetails}`);
  await log(jobId, "info", `check 4 axes: dropped ${droppedNames.join(", ")}`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 5: Size-axis image unification + cm → inch conversion
// ─────────────────────────────────────────────────────────────────────────────

async function check5SizeAxisUnification(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "size-axis-unification",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  // Reload variants in case earlier checks changed things.
  const visible = await prisma.variant.findMany({
    where: { productId: product.id, isHidden: false },
    orderBy: { position: "asc" },
  });
  if (visible.length < 2) return result;
  const optionNames = parseOptionNames(product.optionNames);
  if (optionNames.length < 2) return result;

  // Detect which axis is the size axis (≥50% of visible variants have a size
  // token on that axis). At most one size axis per product.
  let sizeAxisIndex: 0 | 1 | 2 | -1 = -1;
  for (let i = 0; i < optionNames.length; i++) {
    const key = OPT_KEYS[i];
    const sizeCount = visible.filter((v) => looksLikeSizeValue(v[key])).length;
    if (sizeCount / visible.length >= 0.5) {
      sizeAxisIndex = i as 0 | 1 | 2;
      break;
    }
  }
  result.checked = sizeAxisIndex >= 0 ? visible.length : 0;

  // ── Image unification: group by NON-size axis values; share lowest-pos
  //    featuredImageId across the group.
  let imagesUnified = 0;
  if (sizeAxisIndex === 0 || sizeAxisIndex === 1 || sizeAxisIndex === 2) {
    const sizeKey = OPT_KEYS[sizeAxisIndex];
    const groupKeyFor = (v: typeof visible[number]): string =>
      OPT_KEYS.filter((k) => k !== sizeKey)
        .map((k) => v[k] ?? "")
        .join("||");

    const groups = new Map<string, typeof visible>();
    for (const v of visible) {
      const k = groupKeyFor(v);
      const list = groups.get(k) ?? [];
      list.push(v);
      groups.set(k, list);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Find a representative featuredImageId from the group (first that has one).
      const rep = list.find((v) => v.featuredImageId)?.featuredImageId ?? null;
      if (!rep) continue;
      for (const v of list) {
        if (v.featuredImageId !== rep) {
          await prisma.variant.update({
            where: { id: v.id },
            data: { featuredImageId: rep },
          });
          imagesUnified++;
        }
      }
    }
  }

  // ── cm → inch conversion (runs whether or not there's a size axis, since
  //    cm values can appear on any axis; the conversion is value-local).
  let valuesConverted = 0;
  const conversions: string[] = [];
  for (const v of visible) {
    const updates: Partial<Record<OptKey, string>> = {};
    for (const key of OPT_KEYS) {
      const val = v[key];
      if (!val) continue;
      const { converted, changed } = convertCmInValueToInches(val);
      if (changed) {
        updates[key] = converted;
        if (conversions.length < 5) conversions.push(`"${val}" → "${converted}"`);
        valuesConverted++;
      }
    }
    if (Object.keys(updates).length > 0) {
      // Rebuild title.
      const next = { ...v, ...updates };
      const newTitle =
        [next.option1, next.option2, next.option3]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" / ") || v.title;
      await prisma.variant.update({
        where: { id: v.id },
        data: { ...updates, title: newTitle },
      });
    }
  }

  result.fixed = imagesUnified + valuesConverted;
  if (imagesUnified > 0) {
    result.details.push(`unified images across ${imagesUnified} size variant(s)`);
  }
  if (valuesConverted > 0) {
    result.details.push(
      `converted ${valuesConverted} cm/mm/m value(s) to inches: ${conversions.join(", ")}` +
        (valuesConverted > 5 ? "…" : ""),
    );
  }
  if (result.fixed > 0) {
    await log(jobId, "info", `check 5 size-axis: ${imagesUnified} images unified, ${valuesConverted} cm values converted`);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 6: Image-only description re-enrichment retry
// ─────────────────────────────────────────────────────────────────────────────

interface ProductContextShape {
  extractedSpecs?: unknown[];
  featureCallouts?: unknown[];
}

async function check6DescriptionRetry(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "description-retry",
    checked: 1,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  if (!isClaudeConfigured()) {
    result.details.push("ANTHROPIC_API_KEY not set — skipping");
    return result;
  }

  // Three trigger paths:
  //   (a) productContext has no specs AND no callouts → enrichment never
  //       produced anything; full re-enrich.
  //   (b) descriptionHtml is short + image-heavy → also full re-enrich.
  //   (c) productContext HAS data but descriptionHtml still contains raw
  //       1688 supplier-template markers (店铺推荐 cross-sell grid,
  //       dynamic-backup-img class, sdmap-dynamic-offer-list) — the clean
  //       HTML was never generated or got overwritten. Cheap fix: call
  //       rewriteProductDescription which regenerates the clean HTML from
  //       cached productContext (one Claude call, no OCR).
  let mode: "full-enrich" | "rewrite-only" | null = null;
  let specsLen = 0;
  let calloutsLen = 0;
  try {
    const ctx = product.productContext
      ? (JSON.parse(product.productContext) as ProductContextShape)
      : null;
    specsLen = Array.isArray(ctx?.extractedSpecs) ? ctx.extractedSpecs.length : 0;
    calloutsLen = Array.isArray(ctx?.featureCallouts) ? ctx.featureCallouts.length : 0;
    if (specsLen === 0 && calloutsLen === 0) mode = "full-enrich";
  } catch {
    mode = "full-enrich";
  }
  if (!mode) {
    const html = product.descriptionHtml ?? "";
    const imgCount = (html.match(/<img/gi) ?? []).length;
    const textLen = html.replace(/<[^>]+>/g, "").trim().length;
    if (imgCount >= 5 && textLen < 200) mode = "full-enrich";
    else {
      // Trigger (c): supplier-template markers + productContext has data.
      const looksLikeRawTemplate =
        /sdmap-dynamic-offer-list|dynamic-backup-img|店铺推荐|店铺热销|店铺新品/.test(html);
      if (looksLikeRawTemplate && (specsLen > 0 || calloutsLen > 0)) {
        mode = "rewrite-only";
      } else if (textLen < 500 && specsLen < 5) {
        // Trigger (d): description is technically present but too thin to be
        // useful (less than 500 chars of body text AND fewer than 5 cached
        // specs). Re-run the full enrichment pipeline; it'll re-OCR the
        // description images and fall through to swatch OCR as needed.
        mode = "full-enrich";
      }
    }
  }
  if (!mode) return result;

  if (mode === "rewrite-only") {
    try {
      const rewritten = await rewriteProductDescription(product.id);
      if (rewritten.hadCachedContext) {
        result.fixed = 1;
        result.details.push(
          `rewrote description from cached productContext (${rewritten.descriptionHtml.length} chars)`,
        );
        await log(
          jobId,
          "info",
          `check 6 description: rewritten from cached context (raw 1688 template detected)`,
        );
      } else {
        result.flagged = 1;
        result.details.push("rewrite path returned no cached context — fell back to existing HTML");
      }
    } catch (err) {
      result.flagged = 1;
      result.details.push(`rewrite threw: ${err instanceof Error ? err.message : String(err)}`);
      await log(jobId, "warn", `check 6 description: rewrite failed — ${err instanceof Error ? err.message : err}`);
    }
    return result;
  }

  // Re-run full enrichment with a minimal ScrapedProduct shape.
  const scrapedShape = {
    title: product.title,
    handle: product.handle,
    productType: product.productType,
    descriptionHtml: product.descriptionHtml ?? "",
    metaDescription: null,
    vendor: null,
    tags: [],
    optionNames: product.optionNames ? parseOptionNames(product.optionNames) : [],
    variants: [],
    images: [],
    rawPayload: null,
  } as never;

  try {
    const enriched = await enrichDescription1688(scrapedShape, {
      log: async () => {
        // suppress sub-logging — outer caller has its own log
      },
    } as never);
    const specsLen = enriched.productContext.extractedSpecs.length;
    const calloutsLen = enriched.productContext.featureCallouts.length;
    if (specsLen === 0 && calloutsLen === 0) {
      result.flagged = 1;
      result.details.push("re-enrichment still produced no specs/callouts — manual review needed");
      await log(jobId, "warn", `check 6 description: re-enrichment yielded nothing — flagged for manual review`);
      return result;
    }
    await prisma.product.update({
      where: { id: product.id },
      data: {
        descriptionHtml: enriched.descriptionHtml,
        productContext: JSON.stringify(enriched.productContext),
      },
    });
    result.fixed = 1;
    result.details.push(`re-enriched description (gained ${specsLen} specs, ${calloutsLen} callouts)`);
    await log(jobId, "info", `check 6 description: re-enriched (+${specsLen} specs, +${calloutsLen} callouts)`);
  } catch (err) {
    result.flagged = 1;
    result.details.push(`re-enrichment threw: ${err instanceof Error ? err.message : String(err)}`);
    await log(jobId, "warn", `check 6 description: failed — ${err instanceof Error ? err.message : err}`);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 7: Honor the original scrape job's omitCompareAtPrice flag
// ─────────────────────────────────────────────────────────────────────────────

async function check7CompareAtCleanup(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "compare-at-cleanup",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };

  // Find the scrape job that produced this product. ScrapeJob.options is a
  // JSON string conforming to ScrapeOptionsSchema. We mirror loadOptions()
  // in scraper.service.ts:56-72.
  const job = await prisma.scrapeJob.findFirst({
    where: { product: { id: product.id } },
    select: { id: true, options: true },
  });
  if (!job?.options) return result;
  let omit = false;
  try {
    const parsed = ScrapeOptionsSchema.parse(JSON.parse(job.options));
    omit = !!parsed.omitCompareAtPrice;
  } catch {
    // Couldn't parse options — be safe and don't touch compareAt.
    return result;
  }
  result.checked = 1;
  if (!omit) return result; // User wants compareAt; leave alone.

  const cleared = await prisma.variant.updateMany({
    where: { productId: product.id, compareAtPrice: { not: null } },
    data: { compareAtPrice: null },
  });
  if (cleared.count > 0) {
    result.fixed = cleared.count;
    result.details.push(
      `cleared compareAt on ${cleared.count} variant(s) per scrapeJob.options.omitCompareAtPrice`,
    );
    await log(
      jobId,
      "info",
      `check 7 compare-at: cleared ${cleared.count} (omitCompareAtPrice was true at scrape time)`,
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 8: Dimensional enrichment — vision-OCR description images for
// per-variant H/W/D, coverage area, wattage, IP rating, etc. Merges new
// findings into productContext.extractedSpecs and regenerates the
// descriptionHtml so customers see complete specs. 1688 supplier dimension
// callouts are buried in image text and the standard Phase-2 enrichment only
// captures one set; this check is the safety net for dimension fidelity.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DIM_IMAGES_PER_PRODUCT = 20;

// Bumped when the OCR prompt below changes meaningfully — invalidates all
// cached ocrDimsText / ocrPromptVersion rows on ProductImage. The cache check
// in the batch loop only honors a hit when the cached version matches this.
const OCR_PROMPT_VERSION = "v1";

interface ExtractedSpec {
  name: string;
  value: string;
}

// Discriminated return so the caller can distinguish a transient fetch failure
// (don't cache, retry next time) from a Claude NO_DIMS verdict (cache as empty
// so we don't keep re-asking) from a successful extraction (cache the text).
type DimsExtractResult =
  | { kind: "ok"; text: string }
  | { kind: "no_dims" }
  | { kind: "fetch_failed" };

async function extractDimsFromImage(url: string): Promise<DimsExtractResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { kind: "fetch_failed" };
    const buf = Buffer.from(await res.arrayBuffer());
    const resized = await sharp(buf)
      .rotate()
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;
    const raw = await claudeVision({
      imageUrl: dataUri,
      prompt:
        `Extract every piece of measurable / dimensional information visible on this product image. ` +
        `Look for: width, height, depth, diameter, length, weight, wattage (W), voltage (V), coverage / applicable area (m²), color temperature (K / 暖光/中性光/白光), socket type (E27/E14/G9 etc.), IP rating, bulb count, included accessories. ` +
        `Also extract any per-variant / per-size labels attached to each dimension set (e.g. "Model 682 Black Height 45cm" = ONE set; "Model 682 Black Height 60cm" = ANOTHER set). ` +
        `Translate Chinese text to English but keep the original units (cm/mm/m). Output as a flat bullet list, one finding per line. ` +
        `If the image is purely a lifestyle / decorative shot with no dimensional text, respond with EXACTLY "NO_DIMS" and nothing else.`,
      maxTokens: 800,
      temperature: 0,
    });
    const trimmed = raw.trim();
    if (trimmed === "NO_DIMS" || trimmed.startsWith("NO_DIMS")) return { kind: "no_dims" };
    return { kind: "ok", text: trimmed };
  } catch (err) {
    console.warn(`[audit check 8] image extract failed: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "fetch_failed" };
  }
}

/** Per-variant dimensional mapping produced by the consolidation step.
 *  Used to update each variant's option3 (or whichever axis is "Size") with
 *  the full W × H × D string so customers see exact dims in the variant table. */
interface VariantDimMapping {
  style: string;
  size: string;
  fullDims: string;
}

interface ConsolidationResult {
  groupedSpecs: ExtractedSpec[];
  variantDimensions: VariantDimMapping[];
}

interface VariantSummary {
  style: string;
  size: string;
  position: number;
}

async function consolidateDimensionalFindings(
  productTitle: string,
  rawFindings: string[],
  currentStyleValues: string[],
  variantSummaries: VariantSummary[],
): Promise<ConsolidationResult> {
  const empty: ConsolidationResult = { groupedSpecs: [], variantDimensions: [] };
  if (rawFindings.length === 0) return empty;
  const findingsBlock = rawFindings.map((f, i) => `--- Image ${i + 1} ---\n${f}`).join("\n\n");
  const styleClause =
    currentStyleValues.length > 0
      ? `\n\nCurrent STYLE variants on this product: ${currentStyleValues.map((s) => `"${s}"`).join(", ")}.\n` +
        `Source images may reference OLD supplier labels like "Model A" / "Model B" / "682". MAP those to the current style names positionally (1st old → 1st current, etc.) and use the current names in your output.\n`
      : "";
  const variantBlock =
    variantSummaries.length > 0
      ? `\n\nVisible variants on this product (style + size pairs):\n${variantSummaries
          .map((v, i) => `${i + 1}. style="${v.style}" size="${v.size}"`)
          .join("\n")}\n`
      : "";
  const prompt =
    `You are consolidating raw vision-OCR findings from product gallery images into TWO outputs:\n` +
    `  (1) a clean per-style "groupedSpecs" list for the product description\n` +
    `  (2) a per-variant "variantDimensions" map so each variant's Size column can show its full W × H × D\n\n` +
    `Product title: "${productTitle.slice(0, 160)}"${styleClause}${variantBlock}\n\n` +
    `Raw findings from ${rawFindings.length} image(s):\n${findingsBlock}\n\n` +
    `RULES for groupedSpecs (the {name,value} entries in the description's Specifications section):\n` +
    `- ONE entry per STYLE group. When multiple styles share IDENTICAL W × H × D × Coverage, COMBINE them into one entry with comma-separated names: {"name":"Minglan, Shuya Dimensions", "value":"4.7\\"W × 17.5–39.5\\"H × 3.5–3.9\\"D, Coverage 5-8 m²"}\n` +
    `- When styles have DIFFERENT dimensions, give them separate entries: {"name":"Jingyi Dimensions", "value":"4.7\\"W × 11.8\\"H × 2.8\\"D, Coverage 5-8 m²"}\n` +
    `- The VALUE of each entry contains W × H × D + Coverage in one string. If coverage varies per size within a style, include the range or per-size note.\n` +
    `- For non-dimensional specs found in the images (Color Temperature, Wattage, IP Rating, Material, etc.), emit as flat entries: {"name":"Color Temperature","value":"3000K"}\n` +
    `- DO NOT emit any of: bare "Dimensions", "Width", "Height", "Depth", "Diameter", "Length", "Coverage Area" entries. All dimensional info goes into per-style rows.\n` +
    `- DO NOT emit entries with value "Not specified" / "N/A" / "—". If you don't know, omit the entry entirely.\n` +
    `- Convert cm/mm/m → inches at 0.5" resolution. "45 cm" → "17.5\\"". Coverage area stays in m².\n\n` +
    `RULES for variantDimensions (the per-variant Size column update):\n` +
    `- For EACH visible variant listed above, produce a mapping entry: {"style":"<styleValue>","size":"<originalSizeValue>","fullDims":"<W × H × D>"}\n` +
    `- "fullDims" is the COMPLETE dimension string for that variant (e.g. "4.7\\"W × 17.5\\"H × 3.5\\"D"). This becomes the new label in the Size column.\n` +
    `- If you can't confidently determine fullDims for a variant (e.g. vague "Small"/"Large" with no matching image data), OMIT that mapping entry — do NOT guess. The audit will flag those for manual review.\n` +
    `- "size" must match EXACTLY the original size value from the variants list (so the caller can match).\n\n` +
    `Return ONLY a JSON object with shape {"groupedSpecs":[...],"variantDimensions":[...]}. No prefix, no explanation, no markdown fence.\n` +
    `Example: {"groupedSpecs":[{"name":"Minglan, Shuya Dimensions","value":"4.7\\"W × 17.5–39.5\\"H × 3.5–3.9\\"D, Coverage 5-8 m²"}],"variantDimensions":[{"style":"Minglan","size":"17.5\\"","fullDims":"4.7\\"W × 17.5\\"H × 3.5\\"D"}]}`;
  try {
    const raw = await claudeJSON<unknown>({
      user: prompt,
      maxTokens: 2500,
      temperature: 0,
    });
    const out: ConsolidationResult = { groupedSpecs: [], variantDimensions: [] };
    if (typeof raw !== "object" || raw === null) return out;
    const rec = raw as { groupedSpecs?: unknown; variantDimensions?: unknown };
    if (Array.isArray(rec.groupedSpecs)) {
      for (const item of rec.groupedSpecs) {
        if (typeof item !== "object" || item === null) continue;
        const s = item as { name?: unknown; value?: unknown };
        if (typeof s.name !== "string" || typeof s.value !== "string") continue;
        const name = s.name.trim();
        const value = s.value.trim();
        if (!name || !value) continue;
        // Defense-in-depth: filter out the bare W/H/D rows even if the model returned them.
        if (/^(dimensions?|width|height|depth|diameter|length|coverage area)$/i.test(name)) continue;
        if (/^(not specified|n\/?a|—|--|none|unspecified|unknown)$/i.test(value)) continue;
        out.groupedSpecs.push({ name, value });
      }
    }
    if (Array.isArray(rec.variantDimensions)) {
      for (const item of rec.variantDimensions) {
        if (typeof item !== "object" || item === null) continue;
        const v = item as { style?: unknown; size?: unknown; fullDims?: unknown };
        if (
          typeof v.style !== "string" ||
          typeof v.size !== "string" ||
          typeof v.fullDims !== "string"
        ) continue;
        const fullDims = v.fullDims.trim();
        if (!fullDims) continue;
        // Sanity: full dims must contain at least one inch marker.
        if (!/["']|inch|in\b/i.test(fullDims)) continue;
        out.variantDimensions.push({
          style: v.style.trim(),
          size: v.size.trim(),
          fullDims,
        });
      }
    }
    return out;
  } catch (err) {
    console.warn(`[audit check 8] consolidate failed: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}

/** Text-only realignment: when existing extractedSpecs reference stale style
 *  labels (e.g. "Dimensions (Model A Small)") and the variants have since
 *  been renamed to themed values (e.g. ["Yunshi", "Jingyu", "Suiyun"]), ask
 *  Claude to rewrite the spec names + values using the CURRENT style names.
 *  Single text call (~$0.001, ~2s). Returns null on failure so caller can
 *  fall through to vision OCR. */
async function realignSpecStyleLabels(
  productTitle: string,
  existingSpecs: ExtractedSpec[],
  currentStyleValues: string[],
): Promise<ExtractedSpec[] | null> {
  if (existingSpecs.length === 0 || currentStyleValues.length < 2) return null;
  const specsBlock = existingSpecs.map((s) => `- ${s.name}: ${s.value}`).join("\n");
  const prompt =
    `You are realigning a product's existing specs so they use the current variant Style names.\n\n` +
    `Product title: "${productTitle.slice(0, 160)}"\n\n` +
    `Current variant STYLE values: ${currentStyleValues.map((s) => `"${s}"`).join(", ")}\n\n` +
    `Existing spec list:\n${specsBlock}\n\n` +
    `Some spec NAMES or VALUES reference OLD style labels like "Model A", "Model B", "Model C", or supplier codes like "682" / "1612" / "JK-1".\n` +
    `Rewrite the spec list so:\n` +
    `1. Spec names/values that reference old style labels are rewritten to use the CURRENT style values listed above (in positional order: 1st old label → 1st current value, 2nd → 2nd, etc.)\n` +
    `2. Specs that don't reference style labels remain UNCHANGED\n` +
    `3. Specs that reference a label with no current-style counterpart (e.g. supplier had 5 models, current has only 3) — keep the original spec entry\n` +
    `4. Where appropriate, MERGE per-style entries that now share the same value (rare, but cleaner)\n` +
    `5. Keep the spec list complete — don't drop anything important. Output should have AT LEAST as many entries as input.\n\n` +
    `Return ONLY a JSON array of {name, value} objects. No prefix, no explanation, no markdown fence.\n` +
    `Example input/output for reference:\n` +
    `  IN:  {"name":"Dimensions (Model A Small)","value":"15.7\\"W × 2.4\\"H"}\n` +
    `  OUT: {"name":"Dimensions (Yunshi Small)","value":"15.7\\"W × 2.4\\"H"}  // Model A → Yunshi (positional match)`;
  try {
    const result = await claudeJSON<unknown>({
      user: prompt,
      maxTokens: 2000,
      temperature: 0,
    });
    if (!Array.isArray(result)) return null;
    const out: ExtractedSpec[] = [];
    for (const item of result) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as { name?: unknown; value?: unknown };
      if (typeof rec.name !== "string" || typeof rec.value !== "string") continue;
      const name = rec.name.trim();
      const value = rec.value.trim();
      if (!name || !value) continue;
      out.push({ name, value });
    }
    // Sanity: must keep at least the same number of specs.
    if (out.length < existingSpecs.length * 0.8) return null;
    return out;
  } catch (err) {
    console.warn(`[audit check 8 realign] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function check8DimensionalEnrichment(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "dimensional-enrichment",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };
  if (!isClaudeConfigured()) return result;

  // Description images = imageType null OR "source" (not hero, hero-flat,
  // lifestyle). Cap to avoid runaway cost.
  const descImages = product.images
    .filter((i) => i.imageType === null || i.imageType === "source")
    .slice(0, MAX_DIM_IMAGES_PER_PRODUCT);
  if (descImages.length === 0) return result;
  result.checked = descImages.length;

  // Skip-if-already-rich heuristic: if productContext already has BOTH
  // ≥3 distinct dimensional specs (Height / Width / Depth / etc.) AND has
  // Coverage Area or Wattage or Color Temperature recorded, don't burn
  // more vision calls — the spec data is already in. Lets re-running the
  // audit be cheap on already-good products.
  const DIM_SPEC_NAMES = new Set([
    "height", "width", "depth", "diameter", "length", "weight",
  ]);
  const RICH_EXTRA = new Set([
    "coverage area", "wattage", "voltage", "color temperature", "ip rating",
    "socket type", "light source",
  ]);
  let existingSpecs: ExtractedSpec[] = [];
  let existingSpecNames = new Set<string>();
  try {
    const ctx = product.productContext ? JSON.parse(product.productContext) : null;
    if (ctx && Array.isArray(ctx.extractedSpecs)) {
      existingSpecs = ctx.extractedSpecs.filter(
        (s: unknown): s is ExtractedSpec =>
          typeof s === "object" && s !== null &&
          typeof (s as ExtractedSpec).name === "string" &&
          typeof (s as ExtractedSpec).value === "string",
      );
      existingSpecNames = new Set(existingSpecs.map((s) => s.name.toLowerCase()));
    }
  } catch {
    // ignore parse failures
  }
  // Collect current Style/Model axis values from visible variants. Passed to
  // the consolidation prompt so per-style spec entries use TODAY's variant
  // names (Yunshi/Jingyu/Suiyun) not yesterday's supplier codes (Model A/B/C).
  const optionNamesNow = parseOptionNames(product.optionNames);
  const styleAxisIdx = optionNamesNow.findIndex((n) => STYLE_AXIS_NAME_RE.test(n.trim()));
  const visibleNow = product.variants.filter((v) => !v.isHidden);
  const currentStyleValues =
    styleAxisIdx >= 0
      ? Array.from(
          new Set(
            visibleNow
              .map((v) => v[OPT_KEYS[styleAxisIdx]])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0),
          ),
        )
      : [];

  // Style-label mismatch detection: if the product has named Style variants
  // (e.g. ["Yunshi", "Jingyu"]) AND the existing specs reference DIFFERENT
  // labels (e.g. "Dimensions (Model A)"), we need to re-run regardless of
  // rich-enough — to realign the spec labels with current variant names.
  let needsStyleAlignment = false;
  if (currentStyleValues.length >= 2) {
    const currentStyleSet = new Set(currentStyleValues.map((s) => s.toLowerCase()));
    for (const s of existingSpecs) {
      // Look for "Dimensions (X)" / "Height (X)" / etc. where X is a style ref.
      const match = s.name.match(/\(([^)]+)\)/);
      if (!match) continue;
      const refTokens = match[1].toLowerCase().split(/[\s,;/]+/).filter(Boolean);
      // If ANY referenced token looks like a style/model SKU AND isn't in the
      // current style names, the spec is stale.
      for (const tok of refTokens) {
        if (isWaffleSkuValue(tok) || /^model$|^style$|^type$/i.test(tok)) {
          // Bare "Model" / "Style" + "A/B/C" patterns
          needsStyleAlignment = true;
          break;
        }
        if (refTokens.length === 1 && !currentStyleSet.has(tok) && tok.length <= 12) {
          // Single short token not in current style names — likely a stale SKU.
          // Don't trigger on long tokens like "small/medium/large" descriptors.
          if (/^[a-z]+\s*[a-z]?$/i.test(tok) && !/^(small|medium|large|mini|max|min|short|tall)$/i.test(tok)) {
            needsStyleAlignment = true;
            break;
          }
        }
      }
      if (needsStyleAlignment) break;
    }
  }

  const hasDimCount = [...existingSpecNames].filter((n) => DIM_SPEC_NAMES.has(n)).length;
  const hasExtraCount = [...existingSpecNames].filter((n) => RICH_EXTRA.has(n)).length;
  // Detect FRAGMENTED-dim shape: separate bare Width / Height / Depth /
  // Coverage Area entries, OR the original supplier-text "Dimensions" entry
  // with no per-style attribution. This is the EXACT confusing shape the v2
  // redesign is meant to eliminate — force re-run regardless of dim count.
  const FRAGMENTED_NAME_RE = /^(dimensions?|width|height|depth|diameter|length|coverage area)$/i;
  const hasFragmentedDims = existingSpecs.some((s) => FRAGMENTED_NAME_RE.test(s.name.trim()));
  // Detect noise entries we want to purge anyway ("Not specified" / "N/A").
  // NOISE_VALUE_RE is now defined at module scope and reused by check 9.
  const hasNoisyValues = existingSpecs.some((s) => NOISE_VALUE_RE.test(s.value.trim()));
  // Detect vague variant Size values that need fullDims replacement.
  const VAGUE_SIZE_RE = /^(small|medium|large|mini|maxi|x[\-\s]?large|x[\-\s]?small|short|tall)$/i;
  const hasVagueSizes = visibleNow.some((v) => {
    for (const k of OPT_KEYS) {
      const val = v[k];
      if (val && VAGUE_SIZE_RE.test(val.trim())) return true;
    }
    return false;
  });
  const richEnough = hasDimCount >= 3 && hasExtraCount >= 1;
  const forceRerun = hasFragmentedDims || hasNoisyValues || hasVagueSizes || needsStyleAlignment;
  await log(
    jobId,
    "info",
    `check 8 trace: richEnough=${richEnough} (dims=${hasDimCount}, extra=${hasExtraCount}) fragmented=${hasFragmentedDims} noise=${hasNoisyValues} vagueSizes=${hasVagueSizes} needsStyleAlignment=${needsStyleAlignment} currentStyles=[${currentStyleValues.join(",")}]`,
  );

  // STEP 1 (text-only, cheap): if existing specs reference stale style
  // labels (Model A/B/C), have Claude rewrite the names + values using the
  // CURRENT style names (Yunshi/Jingyu/Suiyun) — this is independent of
  // vision OCR. The data is already in productContext; we just need to
  // realign the labels. Runs regardless of richEnough.
  if (needsStyleAlignment && currentStyleValues.length >= 2) {
    try {
      const realigned = await realignSpecStyleLabels(
        product.title,
        existingSpecs,
        currentStyleValues,
      );
      if (realigned && realigned.length > 0) {
        // Replace existingSpecs in DB with realigned set + persist.
        const ctxRealign = product.productContext ? JSON.parse(product.productContext) : {};
        ctxRealign.extractedSpecs = realigned;
        await prisma.product.update({
          where: { id: product.id },
          data: { productContext: JSON.stringify(ctxRealign) },
        });
        // Update local state so the subsequent vision step (if any) sees the realigned data.
        existingSpecs = realigned;
        existingSpecNames = new Set(realigned.map((s) => s.name.toLowerCase()));
        try {
          await rewriteProductDescription(product.id);
        } catch (err) {
          await log(jobId, "warn", `check 8 realign: rewrite description failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
        const realignedCount = realigned.filter((r, i) => r.name !== existingSpecs[i]?.name || r.value !== existingSpecs[i]?.value).length;
        const changed = realignedCount > 0 ? realignedCount : "all";
        result.fixed += typeof changed === "number" ? changed : 1;
        result.details.push(
          `realigned ${typeof changed === "number" ? changed : ""} stale style-labeled spec(s) to current style names [${currentStyleValues.join(", ")}]`,
        );
        await log(jobId, "info", `check 8 realign: rewrote stale style refs to current style names`);
        needsStyleAlignment = false; // realigned successfully; no need to re-detect
      }
    } catch (err) {
      await log(jobId, "warn", `check 8 realign threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (richEnough && !forceRerun) {
    return result; // already rich + clean (no fragmentation, no noise, no vague sizes, style labels align)
  }

  // Vision-OCR each image (concurrency 3 to be polite to Anthropic rate limits).
  // Per-image OCR result cache lives on ProductImage.ocrDimsText +
  // ocrPromptVersion. On a hit we reuse the cached text (empty = NO_DIMS) and
  // skip the Claude call entirely. On a miss we run the Claude call, then
  // best-effort write the result back. Fetch failures are NOT cached so a
  // transient network hiccup retries on the next audit.
  const findings: string[] = [];
  let cacheHits = 0;
  const concurrency = 3;
  for (let i = 0; i < descImages.length; i += concurrency) {
    const batch = descImages.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (img) => {
        if (img.ocrPromptVersion === OCR_PROMPT_VERSION) {
          cacheHits++;
          return { img, cached: true, text: img.ocrDimsText ?? "" };
        }
        const r = await extractDimsFromImage(img.sourceUrl);
        if (r.kind === "fetch_failed") {
          // Don't cache transient failures — retry naturally on next audit.
          return { img, cached: false, text: null as string | null };
        }
        const textToCache = r.kind === "ok" ? r.text : "";
        try {
          await prisma.productImage.update({
            where: { id: img.id },
            data: { ocrDimsText: textToCache, ocrPromptVersion: OCR_PROMPT_VERSION },
          });
        } catch (e) {
          console.warn(
            `[audit check 8] cache write failed for ${img.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return { img, cached: false, text: textToCache };
      }),
    );
    for (const r of results) {
      if (r.text) findings.push(r.text);
    }
  }
  const cacheCost = (cacheHits * 0.005).toFixed(2);
  console.log(
    `[audit check 8] ocr cache: ${cacheHits}/${descImages.length} hit, saved ~$${cacheCost}`,
  );
  if (findings.length === 0) {
    result.details.push(`no dimensional data visible across ${descImages.length} image(s)`);
    return result;
  }

  // Build variant summaries for the consolidation prompt so Claude can produce
  // a per-variant fullDims mapping. STRICT axis detection: only target axes
  // literally named Size/Length/Height/Dimensions/Dimension. NO FALLBACK to
  // other axes — falling back to "Color"/"Finish"/"Number Of Heads" would
  // destroy those columns by overwriting them with dim strings.
  const sizeAxisIdx = optionNamesNow.findIndex((n) =>
    /^(size|length|height|dimensions?)$/i.test(n.trim()),
  );
  // sizeAxisKey is null when the product has no explicit Size axis — in
  // that case Check 8 only writes specs, never touches variant rows.
  const sizeAxisKey: OptKey | null =
    sizeAxisIdx >= 0 ? OPT_KEYS[sizeAxisIdx] : null;
  const styleAxisKey: OptKey | null =
    styleAxisIdx >= 0 ? OPT_KEYS[styleAxisIdx] : null;

  const variantSummaries: VariantSummary[] = visibleNow.map((v) => ({
    style: (styleAxisKey ? v[styleAxisKey] : null) ?? "",
    size: (sizeAxisKey ? v[sizeAxisKey] : null) ?? "",
    position: v.position,
  }));

  // Consolidate via Claude text-only call — per-style grouped specs + per-variant dims map.
  const consolidation = await consolidateDimensionalFindings(
    product.title,
    findings,
    currentStyleValues,
    variantSummaries,
  );
  await log(
    jobId,
    "info",
    `check 8 trace: vision yielded ${findings.length}/${descImages.length} findings; consolidation returned ${consolidation.groupedSpecs.length} groupedSpecs + ${consolidation.variantDimensions.length} variantDimensions`,
  );
  if (consolidation.groupedSpecs.length === 0 && consolidation.variantDimensions.length === 0) {
    result.details.push(
      `extracted from ${findings.length}/${descImages.length} image(s) but consolidation returned nothing usable`,
    );
    return result;
  }

  // ── PURGE: drop redundant + noisy entries from existing specs ────────────
  // 1. Drop bare W/H/D/Coverage/etc. entries when new per-style entries replace them.
  // 2. Drop "Not specified" / "N/A" / "—" valued entries — pure noise.
  // 3. Drop stale style-label entries (existing logic — preserved).
  const hasNewPerStyleDimEntry = consolidation.groupedSpecs.some((s) =>
    /\bdimensions?\b/i.test(s.name) || /\bdims?\b/i.test(s.name),
  );
  const currentStyleSetLower = new Set(currentStyleValues.map((s) => s.toLowerCase()));
  // Filter pass: drop noisy values, bare dim entries (when superseded), and
  // stale style-label entries. NOISE_VALUE_RE + FRAGMENTED_NAME_RE are
  // defined earlier in this function — reuse them here, do not redeclare.
  let keptSpecs: ExtractedSpec[] = existingSpecs.filter((s) => {
    // Drop noisy values
    if (NOISE_VALUE_RE.test(s.value.trim())) return false;
    // Drop bare dim entries IF we have new per-style replacements
    if (hasNewPerStyleDimEntry && FRAGMENTED_NAME_RE.test(s.name.trim())) return false;
    // Drop stale style-label entries (existing logic)
    if (needsStyleAlignment && currentStyleValues.length > 0) {
      const m = s.name.match(/\(([^)]+)\)/);
      if (m) {
        const refTokens = m[1].toLowerCase().split(/[\s,;/]+/).filter(Boolean);
        const looksLikeStaleStyle =
          refTokens.some((t) => isWaffleSkuValue(t) || /^model$|^style$|^type$/i.test(t)) ||
          (refTokens.length === 1 &&
            !currentStyleSetLower.has(refTokens[0]) &&
            /^[a-z]+$/i.test(refTokens[0]) &&
            !/^(small|medium|large|mini|max|min|short|tall)$/i.test(refTokens[0]));
        if (looksLikeStaleStyle) return false;
      }
    }
    return true;
  });
  const purgedCount = existingSpecs.length - keptSpecs.length;

  // Dedup by spec NAME — keep first occurrence. Filters out duplicates that
  // would result from new entries colliding with old ones (rare but possible).
  const seenNames = new Set<string>();
  const dedupedNew: ExtractedSpec[] = [];
  for (const s of consolidation.groupedSpecs) {
    const key = s.name.toLowerCase();
    if (seenNames.has(key) || keptSpecs.some((k) => k.name.toLowerCase() === key)) continue;
    seenNames.add(key);
    dedupedNew.push(s);
  }
  const mergedSpecs: ExtractedSpec[] = [...keptSpecs, ...dedupedNew];

  // Persist specs.
  const ctxRaw = product.productContext ? JSON.parse(product.productContext) : {};
  ctxRaw.extractedSpecs = mergedSpecs;
  await prisma.product.update({
    where: { id: product.id },
    data: { productContext: JSON.stringify(ctxRaw) },
  });

  // ── UPDATE variant.option3 (Size column) from variantDimensions map ───────
  // Apply partial updates: every variant Claude could map gets updated; the
  // rest get flagged for manual review. Removed the previous 50% coverage
  // threshold — it was rejecting valid partial coverage (e.g. cmpjswf6e
  // where Minglan/Shuya are mappable but Jingyi/Luming aren't visible in
  // the gallery). The consolidation prompt is explicit about NOT guessing,
  // so a low coverage means "the rest are genuinely unresolvable", not
  // hallucination.
  let variantUpdates = 0;
  const variantFlags: string[] = [];
  if (sizeAxisKey && consolidation.variantDimensions.length > 0) {
    const mapByKey = new Map<string, string>();
    for (const m of consolidation.variantDimensions) {
      const k = `${m.style}||${m.size}`;
      if (!mapByKey.has(k)) mapByKey.set(k, m.fullDims);
    }
    for (const v of visibleNow) {
      const styleVal = (styleAxisKey ? v[styleAxisKey] : null) ?? "";
      const sizeVal = (v[sizeAxisKey] ?? "") as string;
      const newDims = mapByKey.get(`${styleVal}||${sizeVal}`);
      if (!newDims) {
        variantFlags.push(`${styleVal || "(no style)"} / ${sizeVal || "(no size)"}`);
        continue;
      }
      if (v[sizeAxisKey] === newDims) continue; // already correct
      const newOptionValues = {
        [sizeAxisKey]: newDims,
      } as Record<OptKey, string>;
      const o1 = sizeAxisKey === "option1" ? newDims : v.option1;
      const o2 = sizeAxisKey === "option2" ? newDims : v.option2;
      const o3 = sizeAxisKey === "option3" ? newDims : v.option3;
      const newTitle =
        [o1, o2, o3]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(" / ") || v.title;
      await prisma.variant.update({
        where: { id: v.id },
        data: { ...newOptionValues, title: newTitle },
      });
      variantUpdates++;
    }
  } else if (sizeAxisKey) {
    // No variantDimensions returned — flag all variants with vague sizes for review.
    for (const v of visibleNow) {
      const sizeVal = (v[sizeAxisKey] ?? "") as string;
      if (sizeVal && VAGUE_SIZE_RE.test(sizeVal.trim())) {
        const styleVal = (styleAxisKey ? v[styleAxisKey] : null) ?? "";
        variantFlags.push(`${styleVal || "(no style)"} / ${sizeVal}`);
      }
    }
  }

  // Regenerate the descriptionHtml from updated specs.
  try {
    await rewriteProductDescription(product.id);
  } catch (err) {
    await log(
      jobId,
      "warn",
      `check 8: spec merge OK but description rewrite failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  result.fixed = dedupedNew.length + variantUpdates;
  const specSample = dedupedNew.slice(0, 3).map((s) => `${s.name}=${s.value.slice(0, 50)}`).join(" | ");
  result.details.push(
    `+${dedupedNew.length} per-style spec(s) from ${findings.length} image(s); purged ${purgedCount} redundant/noisy entries; updated ${variantUpdates} variant.option${sizeAxisIdx >= 0 ? sizeAxisIdx + 1 : "?"} (${variantSummaries.length - variantUpdates - variantFlags.length} unchanged, ${variantFlags.length} unresolvable)` +
      (specSample ? ` — sample: ${specSample}` : ""),
  );
  if (variantFlags.length > 0) {
    result.flagged = variantFlags.length;
    result.details.push(
      `unresolvable variants (size column left as-is, manual review): ${variantFlags.slice(0, 5).join(", ")}${variantFlags.length > 5 ? "…" : ""}`,
    );
  }
  await log(
    jobId,
    "info",
    `check 8 dims: +${dedupedNew.length} per-style spec(s), -${purgedCount} purged, ${variantUpdates} variant.option3 updates, ${variantFlags.length} flagged`,
  );
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 9: Purge noise specs ("Not specified" / "N/A" / "—") from
// productContext.extractedSpecs. Check 8's vision path already does this
// when it runs, but check 8 only fires for products with rich enough dim
// data — the rest still ship "Not specified" rows into the description
// template. Run unconditionally so the customer never sees a "Not specified"
// row. (If the value's genuinely informative — e.g. "Bulb: Not Included" — it
// won't match NOISE_VALUE_RE.)
// ─────────────────────────────────────────────────────────────────────────────

async function check9PurgeNoiseSpecs(
  product: LoadedProduct,
  jobId: string | null,
): Promise<AuditCheckResult> {
  const result: AuditCheckResult = {
    check: "purge-noise-specs",
    checked: 0,
    fixed: 0,
    flagged: 0,
    details: [],
  };
  if (!product.productContext) return result;
  let ctx: { extractedSpecs?: Array<{ name?: string; value?: string }> } | null;
  try {
    ctx = JSON.parse(product.productContext) as typeof ctx;
  } catch {
    return result;
  }
  if (!ctx || !Array.isArray(ctx.extractedSpecs) || ctx.extractedSpecs.length === 0) {
    return result;
  }
  result.checked = ctx.extractedSpecs.length;
  const kept = ctx.extractedSpecs.filter((s) => {
    if (!s || typeof s.value !== "string") return true;
    return !NOISE_VALUE_RE.test(s.value.trim());
  });
  const dropped = ctx.extractedSpecs.length - kept.length;
  if (dropped === 0) return result;
  ctx.extractedSpecs = kept;
  await prisma.product.update({
    where: { id: product.id },
    data: { productContext: JSON.stringify(ctx) },
  });
  result.fixed = dropped;
  result.details.push(`dropped ${dropped} noise spec row(s) ("Not specified" / "N/A" / "—" etc.)`);
  await log(jobId, "info", `check 9 noise-specs: dropped ${dropped} row(s)`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function runPostScrapeAudit(
  productId: string,
  jobId: string | null = null,
): Promise<AuditResult> {
  const tStart = Date.now();
  await log(jobId, "info", `starting audit for product ${productId}`);

  const result: AuditResult = {
    productId,
    checks: [],
    totalFixed: 0,
    totalFlagged: 0,
    durationMs: 0,
  };

  // Each check reloads the product so it sees the state after the previous
  // check's writes. Cheap (one Postgres round-trip).
  const checks: Array<
    (p: LoadedProduct, j: string | null) => Promise<AuditCheckResult>
  > = [
    check1WaffleSku,
    check2VariantsWithoutImages,
    check3PackAxisRemnants,
    check3aBulbIncludedAxis,
    check4EmptyAxes,
    check5SizeAxisUnification,
    check6DescriptionRetry,
    check7CompareAtCleanup,
    check8DimensionalEnrichment,
    check9PurgeNoiseSpecs,
  ];

  for (const fn of checks) {
    let product = await loadProductFull(productId);
    if (!product) {
      await log(jobId, "error", `product ${productId} disappeared mid-audit — aborting`);
      break;
    }
    try {
      const checkRes = await fn(product, jobId);
      result.checks.push(checkRes);
      result.totalFixed += checkRes.fixed;
      result.totalFlagged += checkRes.flagged;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await log(jobId, "warn", `check ${fn.name} crashed (non-fatal): ${msg}`);
      result.checks.push({
        check: fn.name,
        checked: 0,
        fixed: 0,
        flagged: 1,
        details: [`crashed: ${msg.slice(0, 200)}`],
      });
      result.totalFlagged += 1;
    }
  }

  result.durationMs = Date.now() - tStart;
  await log(
    jobId,
    "info",
    `audit done in ${result.durationMs}ms — ${result.totalFixed} fix(es), ${result.totalFlagged} flag(s) across ${result.checks.length} check(s)`,
  );
  return result;
}
