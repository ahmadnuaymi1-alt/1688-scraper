/**
 * Claude-backed "luxury but fair" pricing strategy.
 *
 * Ported from LEGACY/src/lib/ai/claude-pricing-client.ts. The legacy shape used
 * a richer rationale schema (oneLineRead, lifters, saturation flag, caveats,
 * naming suggestion); the NEW project's `AiPricingRationale` is intentionally
 * simpler — recommended tier + ladder + comps + marketSaturated + notes. The
 * Claude prompt still asks for the rich schema (better rationale quality) but
 * we collapse the response down to the NEW shape before returning.
 *
 * Web search is wired via Anthropic's server-side `web_search_20250305` tool
 * with `max_uses: 3`. Uses the SDK (not raw fetch) so we share the retry +
 * auth path with the rest of the codebase.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  getClaudeClient,
  isClaudeConfigured,
  withClaudeRetry,
} from "@/lib/ai/claude-client";
import { recordUsage } from "@/lib/ai/usage-tracker";
import type {
  AiPricingRationale,
  PricingComp,
  PricingTier,
} from "@/types/pricing-rationale";
import type { ScrapedProduct } from "@/types/product";
import type { ScrapeOptions } from "@/types/scrape-options";
import { computeLandedFromRawPayload } from "@/lib/pricing/landed-cost";
import type { LandedCostBreakdown } from "@/types/pricing-rationale";

const PRICING_MODEL = "claude-haiku-4-5";

/**
 * Psychology breakpoints used by both the prompt instructions to Claude AND
 * the post-process clamp when scaling the ladder to enforce the landed × 2.0
 * hard floor. Snapping to the nearest breakpoint above the target keeps prices
 * looking deliberate ($129 not $128.37).
 */
const PSYCHOLOGY_BREAKPOINTS = [
  49, 59, 69, 79, 89, 99, 109, 119, 129, 149, 169, 179, 199, 219, 229,
  249, 279, 299, 329, 349, 379, 399, 449, 499, 599, 699, 799, 899, 999,
  1199, 1499, 1799, 1999, 2499, 2999,
];

/** Snap a number UP to the nearest psychology breakpoint at-or-above it. */
function snapUpToBreakpoint(n: number): number {
  for (const bp of PSYCHOLOGY_BREAKPOINTS) {
    if (bp >= n) return bp;
  }
  return Math.ceil(n / 100) * 100;
}

export { isClaudeConfigured };

function buildPricingPrompt(input: {
  productTitle: string;
  productType: string | null;
  sourceCost: number;
  sourceCurrency: string;
  targetCurrency: string;
  storePositioning?: "value" | "mid" | "premium";
  variants: Array<{
    position: number;
    title: string;
    option1?: string;
    option2?: string;
    option3?: string;
  }>;
  /** Optional landed-cost breakdown. When present, drives the FLOOR/TARGET/STRETCH
   * tier prices the AI must use. Tells Claude the true USD cost of goods + shipping,
   * derived from the rawPayload (CNY-tagged supplier wholesale + weight bracket). */
  landedCost?: {
    landedUSD: number;
    supplierUSD: number;
    shippingUSD: number;
    weightG: number;
    weightSource: string;
    floorUSD: number;
    targetUSD: number;
    stretchUSD: number;
  };
}): string {
  const positioning = input.storePositioning ?? "premium";
  const typeLine = input.productType
    ? `- Type: ${input.productType}`
    : `- Type: (unspecified — infer from title)`;
  const variantLines = input.variants
    .map((v) => {
      const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
      return `  pos=${v.position}: ${opts || v.title}`;
    })
    .join("\n");

  const landedBlock = input.landedCost
    ? `
LANDED COST REFERENCE (USE THIS):
- Supplier wholesale: $${input.landedCost.supplierUSD.toFixed(2)} USD (converted from CNY)
- Shipping (est. ${input.landedCost.weightG}g${input.landedCost.weightSource === "fallback-2kg" ? " — ⚠ supplier weight missing, using 2kg fallback" : ""}): $${input.landedCost.shippingUSD.toFixed(2)} USD
- LANDED: $${input.landedCost.landedUSD.toFixed(2)} USD per unit

THREE FIXED TIER PRICES (these are not suggestions — pick one):
- FLOOR (landed × 2.0):   $${input.landedCost.floorUSD.toFixed(2)}   ← HARD MINIMUM, never recommend below this
- TARGET (landed × 2.5):  $${input.landedCost.targetUSD.toFixed(2)}   ← preferred margin baseline
- STRETCH (landed × 3.0): $${input.landedCost.stretchUSD.toFixed(2)}   ← upper if boutique comps support it
`
    : `
LANDED COST REFERENCE: unavailable for this product (no rawPayload supplied).
Fall back to: launch >= ${input.sourceCost.toFixed(2)} ${input.sourceCurrency} × 2.0 (margin floor).
`;

  return `You are pricing a product for VILVIDA — a West-Elm-aesthetic premium home decor store. The customer who lands on Vilvida arrives in a premium mindset, NOT comparison-shopping you item-by-item against Amazon. Use the web_search tool to find real comparable products before deciding the price ladder.

STORE CONTEXT (CRITICAL):
- Vilvida = West Elm / Pottery Barn aesthetic premium positioning, lifestyle imagery is high-end, customers expect $59-$399 price points for lighting/home decor.
- Below $50 is unappealing for single-purchase items unless the product is genuinely entry-level. Push to STRETCH tier when boutique comps support it.
- Do NOT anchor against Amazon mass-market dupes (LamQee, BICIK, RUNNUP, generic no-name) — those inform the FLOOR ONLY, never the ceiling.
- Anchor against: Visual Comfort, Hinkley, Modern Forms, Schoolhouse, West Elm, Pottery Barn, Cedar & Moss, Hudson Valley, Lulu and Georgia, Crate & Barrel premium lines.

PRODUCT
- Title: ${input.productTitle}
${typeLine}
- Source cost: ${input.sourceCost.toFixed(2)} ${input.sourceCurrency} (raw supplier — see landed cost below for true cost)
- Target sell currency: ${input.targetCurrency}
- Store positioning hint: ${positioning}
${landedBlock}
VARIANTS (${input.variants.length} total):
${variantLines}

STEPS — execute and return structured JSON matching the schema below.

1. ONE-LINE READ — what makes this product different from generic peers; what material/design/feature story can defend a premium price (1 sentence).

2. ANCHOR PRICES — search the web for 3–6 comparable products in TWO tiers (skip mass-market unless needed for context):
   - "boutique" (Visual Comfort, Hinkley, Modern Forms, Schoolhouse, West Elm, Pottery Barn, Cedar & Moss, Hudson Valley, RBW, Allied Maker, Lulu and Georgia)
   - "mainstream" (Wayfair branded mid-tier, Crate & Barrel entry, Lumens generic, Pottery Barn entry)
   - "floor" only if needed to show the lower bound (Amazon, Home Depot Hampton Bay) — these set the FLOOR, NOT the ceiling.
   For each comp: brand, product (if known), price (string with currency symbol), url (real Search result URL or omit).

3. SATURATION CHECK — search TikTok / Amazon / AliExpress / Temu for the same silhouette and return a "high" | "medium" | "low" flag.

4. DECISION TREE (use the FLOOR/TARGET/STRETCH tier prices above when landed cost is provided):
   - If boutique comp band SUPPORTS STRETCH → recommend STRETCH
   - Else if mid-tier comp band SUPPORTS TARGET → recommend TARGET (this is the default for most products)
   - Else if only mass-market supports FLOOR → recommend FLOOR + note "comps don't support target margin"
   - NEVER recommend launch below FLOOR. Snap to the nearest psychology breakpoint above the chosen tier.

5. PRICING LADDER — derive four numbers in ${input.targetCurrency} (snap each to a psychology breakpoint
   from this list: 49 / 59 / 69 / 79 / 89 / 99 / 109 / 119 / 129 / 149 / 169 / 179 / 199 / 219 / 229 / 249 / 279 / 299 / 329 / 349 / 379 / 399 / 449 / 499 / 599 / 699 / 799 / 899 / 999 / 1199 / 1499):
   - launch = the tier chosen in step 4 (FLOOR, TARGET, or STRETCH), snapped UP to nearest breakpoint if needed to stay ≥ tier
   - stretch = launch + one breakpoint up
   - bundle = stretch + 5–15
   - compareAt = launch × 1.30 to 1.45, snapped to a clean number

6. PER-VARIANT PRICING — decide if variants should share one price or get tiered prices.
   - Inspect the variants list above. If they differ ONLY on color / finish / pattern / style (visual choice with same physical scope), return mode="uniform" — every variant gets the same anchor price.
   - If they differ on a dimension that materially affects perceived value (size, length/width/height, capacity, wattage, count of pieces, head count, lumen output), return mode="tiered" with 2-4 tiers.
   - Each tier is a label + the list of variant positions that belong to it + a multiplier applied to the ladder launch price. Multipliers should range 0.75 (clearly smallest/least) → 1.0 (anchor/baseline) → 1.6 (clearly biggest/most). Be conservative — only create a new tier when a customer would notice and accept the price gap.
   - The 'rationale' is ONE short sentence ("Sized small/medium/large", "Color-only — uniform", "Wattage steps 5W/10W/15W", etc).
   - Every variant position must appear in exactly one tier when mode="tiered".

7. NOTES — write a SINGLE short paragraph (2–3 sentences MAX, ≤ 60 words total). Mention which tier you picked (FLOOR / TARGET / STRETCH), which boutique brand anchor justifies it, and any caveat about the comp set. Plain text. NO headings, NO bullets.

HARD RULES:
- HARD FLOOR: launch >= ${input.landedCost ? `landed × 2.0 = $${input.landedCost.floorUSD.toFixed(2)}` : `sourceCost converted to ${input.targetCurrency} × 2.0`}. Never below.
- Saturation = "high" caps the ladder at TARGET (not below TARGET). Premium positioning does NOT punish for saturation — it acknowledges the product still needs to make margin.
- Never invent a comp. If a tier has no real Search comps, return an empty array for it — do not fabricate URLs.
- Don't anchor against Amazon $20-50 dupes as the ceiling. They set the floor, not the comp band.

Return ONLY valid JSON, no markdown fences, no commentary, matching this schema EXACTLY:
{
  "comps": [{ "tier": "boutique"|"mainstream"|"floor", "brand": "string", "product": "string?", "price": "string", "url": "string?" }],
  "saturation": "low"|"medium"|"high",
  "ladder": { "launch": number, "stretch": number, "bundle": number, "compareAt": number },
  "perVariantPricing": {
    "mode": "uniform"|"tiered",
    "rationale": "string (≤ 1 short sentence)",
    "tiers": [{ "label": "string", "variantPositions": [number, ...], "multiplier": number }]
  },
  "notes": "string (2-3 sentences, ≤60 words, plain text — see step 7)"
}
- "tiers" MUST be present and non-empty when mode === "tiered", and ABSENT (or empty array) when mode === "uniform".`;
}

interface RawPricingOutput {
  comps?: Array<{
    tier?: "boutique" | "mainstream" | "floor";
    brand?: string;
    product?: string;
    price?: string;
    url?: string;
  }>;
  saturation?: "low" | "medium" | "high";
  ladder?: {
    launch?: number;
    stretch?: number;
    bundle?: number;
    compareAt?: number;
  };
  perVariantPricing?: {
    mode?: "uniform" | "tiered";
    rationale?: string;
    tiers?: Array<{
      label?: string;
      variantPositions?: number[];
      multiplier?: number;
    }>;
  };
  notes?: string;
}

function tryParseJsonFromText(text: string): unknown {
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

function parseCompPrice(priceStr: string | undefined): number {
  if (!priceStr) return 0;
  // Strip currency symbols, commas, whitespace
  const cleaned = priceStr.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function detectCurrency(priceStr: string | undefined, fallback: string): string {
  if (!priceStr) return fallback;
  if (/\$/.test(priceStr)) return "USD";
  if (/£/.test(priceStr)) return "GBP";
  if (/€/.test(priceStr)) return "EUR";
  if (/¥/.test(priceStr) || /CNY/i.test(priceStr)) return "CNY";
  return fallback;
}

/**
 * Public entry point. Maps a `ScrapedProduct` + `ScrapeOptions` → the
 * `AiPricingRationale` shape used by the NEW project.
 *
 * Anchor cost selection:
 *   - Prefer `ScrapeOptions.costPerItem` if set
 *   - Else use the first variant's `supplierCost`
 *   - Else use the first variant's `price`
 *   - Currency comes from `ScrapeOptions.sourceCurrency` (defaults to "USD"
 *     when "auto" or missing)
 */
export async function suggestPricingStrategy(
  product: ScrapedProduct,
  options: ScrapeOptions,
): Promise<AiPricingRationale> {
  if (!isClaudeConfigured()) {
    throw new Error("ANTHROPIC_API_KEY is not set — cannot run pricing strategy");
  }

  // Resolve source cost
  let sourceCost = 0;
  if (options.costPerItem) {
    const parsed = parseFloat(options.costPerItem);
    if (Number.isFinite(parsed) && parsed > 0) sourceCost = parsed;
  }
  if (sourceCost <= 0 && product.variants.length > 0) {
    const v = product.variants[0];
    const supplier = v.supplierCost ? parseFloat(v.supplierCost) : NaN;
    const price = parseFloat(v.price);
    if (Number.isFinite(supplier) && supplier > 0) sourceCost = supplier;
    else if (Number.isFinite(price) && price > 0) sourceCost = price;
  }
  if (sourceCost <= 0) {
    throw new Error(
      "suggestPricingStrategy: could not resolve a non-zero source cost from options or variants",
    );
  }

  const sourceCurrency =
    options.sourceCurrency && options.sourceCurrency !== "auto"
      ? options.sourceCurrency
      : "USD";
  const targetCurrency = sourceCurrency;

  // Compute landed cost from rawPayload (bypasses currency-corrupted
  // Variant.supplierCost). Returns null when rawPayload is missing or
  // unparseable — caller falls back to the old sourceCost-only behavior.
  const landed =
    typeof product.rawPayload === "string" && product.rawPayload.length > 0
      ? computeLandedFromRawPayload(product.rawPayload)
      : null;

  const landedForPrompt = landed
    ? {
        landedUSD: landed.landedUSD,
        supplierUSD: landed.supplierUSD,
        shippingUSD: landed.shippingUSD,
        weightG: landed.weightG,
        weightSource: landed.weightSource,
        floorUSD: Math.round(landed.landedUSD * 2.0 * 100) / 100,
        targetUSD: Math.round(landed.landedUSD * 2.5 * 100) / 100,
        stretchUSD: Math.round(landed.landedUSD * 3.0 * 100) / 100,
      }
    : undefined;

  const prompt = buildPricingPrompt({
    productTitle: product.title,
    productType: product.productType ?? null,
    sourceCost,
    sourceCurrency,
    targetCurrency,
    variants: product.variants.map((v, i) => ({
      position: typeof v.position === "number" ? v.position : i,
      title: v.title ?? "",
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
    })),
    landedCost: landedForPrompt,
  });

  // We use the SDK directly here (not claudeText) because we need to pass the
  // `tools` parameter for web_search — the shared `claudeText()` helper doesn't
  // expose tools. The retry is delegated to `withClaudeRetry` which retries on
  // 429 / 529 / 5xx / network with jittered exponential backoff (5 attempts,
  // 4s base — same shape as the old inline loop, plus 529/5xx coverage that
  // the old loop missed).
  const client = getClaudeClient();
  let res: Anthropic.Message;
  try {
    res = await withClaudeRetry(
      () =>
        client.messages.create({
          model: PRICING_MODEL,
          max_tokens: 4096,
          temperature: 0.1,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: 3,
            },
          ],
          messages: [{ role: "user", content: prompt }],
        }),
      { attempts: 5, baseDelayMs: 4000, label: "pricing" },
    );
    if (res.usage) {
      recordUsage("anthropic", PRICING_MODEL, {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
        cacheWrite: res.usage.cache_creation_input_tokens,
        cacheRead: res.usage.cache_read_input_tokens,
        webSearches: res.usage.server_tool_use?.web_search_requests ?? 0,
      });
    }
  } catch (err) {
    throw new Error(
      `suggestPricingStrategy: Anthropic call failed — ${err instanceof Error ? err.message : err}`,
    );
  }

  // Claude's response may interleave tool_use blocks; only `text` blocks carry the final JSON.
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("suggestPricingStrategy: Claude returned no text content");
  }

  let parsed: RawPricingOutput;
  try {
    parsed = tryParseJsonFromText(text) as RawPricingOutput;
  } catch (err) {
    throw new Error(
      `suggestPricingStrategy: failed to parse Claude JSON (${err instanceof Error ? err.message : err})`,
    );
  }

  if (
    !parsed.ladder ||
    typeof parsed.ladder.launch !== "number" ||
    typeof parsed.ladder.stretch !== "number" ||
    typeof parsed.ladder.bundle !== "number" ||
    typeof parsed.ladder.compareAt !== "number"
  ) {
    throw new Error("suggestPricingStrategy: Claude response missing valid ladder");
  }

  // HARD MARGIN FLOOR: launch >= landed × 2.0 when landed is available.
  // When landed is unavailable, fall back to the legacy sourceCost × 1.5 floor.
  // The clamp scales the ENTIRE ladder by (hardFloor / aiLaunch) to preserve
  // the AI's chosen ratios between launch / stretch / bundle / compareAt.
  const aiLaunchRaw = parsed.ladder.launch;
  const hardFloor = landed ? landed.landedUSD * 2.0 : sourceCost * 1.5;
  let launch: number;
  let stretch: number;
  let bundle: number;
  let compareAt: number;
  let clampReason: LandedCostBreakdown["clampReason"];
  if (aiLaunchRaw < hardFloor) {
    // AI undershot — snap launch up to the nearest breakpoint at-or-above
    // the floor, then scale the rest of the ladder proportionally.
    const snappedLaunch = snapUpToBreakpoint(hardFloor);
    const scale = snappedLaunch / aiLaunchRaw;
    launch = snappedLaunch;
    stretch = Math.max(snapUpToBreakpoint(parsed.ladder.stretch * scale), launch);
    bundle = Math.max(snapUpToBreakpoint(parsed.ladder.bundle * scale), stretch);
    compareAt = Math.max(parsed.ladder.compareAt * scale, launch * 1.3);
    clampReason = landed ? "floored-up" : "fallback-no-landed";
  } else {
    launch = parsed.ladder.launch;
    stretch = Math.max(parsed.ladder.stretch, launch);
    bundle = Math.max(parsed.ladder.bundle, stretch);
    compareAt = Math.max(parsed.ladder.compareAt, launch * 1.3);
    clampReason = landed ? "ai-above-floor" : "fallback-no-landed";
  }

  const ladder: PricingTier[] = [
    {
      label: "launch",
      price: launch,
      reasoning: "Launch tier — mainstream-mid minus trust deficit.",
    },
    {
      label: "stretch",
      price: stretch,
      reasoning: "Stretch tier — one breakpoint above launch.",
    },
    {
      label: "bundle",
      price: bundle,
      reasoning: "Bundle tier — stretch + small accessory uplift.",
    },
    {
      label: "compareAt",
      price: compareAt,
      reasoning: "Compare-at — boutique-frame reference price.",
    },
  ];

  const comps: PricingComp[] = Array.isArray(parsed.comps)
    ? parsed.comps
        .filter((c) => c && c.brand)
        .map((c) => {
          const title = [c.brand, c.product].filter(Boolean).join(" — ") || c.brand || "";
          return {
            title,
            price: parseCompPrice(c.price),
            currency: detectCurrency(c.price, targetCurrency),
            ...(c.url ? { url: c.url } : {}),
            ...(c.tier ? { source: c.tier } : {}),
          };
        })
    : [];

  const marketSaturated = parsed.saturation === "high";
  const notes = parsed.notes?.trim() ?? "";

  // Sanitize the optional per-variant pricing block. We only honor a "tiered"
  // mode when every tier has a valid label, non-empty positions, and a
  // multiplier in a sane range. Anything malformed falls back to undefined
  // (= legacy uniform behavior).
  const knownPositions = new Set(
    product.variants.map((v, i) => (typeof v.position === "number" ? v.position : i)),
  );
  let perVariantPricing: AiPricingRationale["perVariantPricing"];
  const pvp = parsed.perVariantPricing;
  if (pvp && (pvp.mode === "uniform" || pvp.mode === "tiered")) {
    if (pvp.mode === "uniform") {
      perVariantPricing = {
        mode: "uniform",
        rationale: typeof pvp.rationale === "string" ? pvp.rationale.trim() : "Uniform pricing",
      };
    } else {
      const validatedTiers = Array.isArray(pvp.tiers)
        ? pvp.tiers
            .map((t) => {
              const positions = Array.isArray(t.variantPositions)
                ? t.variantPositions.filter(
                    (n): n is number => typeof n === "number" && knownPositions.has(n),
                  )
                : [];
              const mult =
                typeof t.multiplier === "number" && Number.isFinite(t.multiplier)
                  ? Math.min(2.5, Math.max(0.5, t.multiplier))
                  : 1;
              const label = typeof t.label === "string" && t.label.trim() ? t.label.trim() : "Tier";
              return { label, variantPositions: positions, multiplier: mult };
            })
            .filter((t) => t.variantPositions.length > 0)
        : [];
      if (validatedTiers.length >= 2) {
        perVariantPricing = {
          mode: "tiered",
          rationale:
            typeof pvp.rationale === "string" ? pvp.rationale.trim() : "Tiered by variant",
          tiers: validatedTiers,
        };
      } else {
        // Fewer than 2 valid tiers means tiering has no effect — collapse to uniform.
        perVariantPricing = { mode: "uniform", rationale: "Tier proposal collapsed — only 1 tier" };
      }
    }
  }

  // Build the optional landed-cost breakdown for the audit trail. Only
  // attached when landed cost was successfully computed.
  let landedCostBreakdown: LandedCostBreakdown | undefined;
  if (landed) {
    const marginPct = launch > 0 ? Math.round(((launch - landed.landedUSD) / launch) * 1000) / 10 : 0;
    landedCostBreakdown = {
      supplierCNY: landed.supplierCNY,
      supplierUSD: landed.supplierUSD,
      weightG: landed.weightG,
      weightSource: landed.weightSource,
      shippingUSD: landed.shippingUSD,
      landedUSD: landed.landedUSD,
      floorUSD: Math.round(landed.landedUSD * 2.0 * 100) / 100,
      targetUSD: Math.round(landed.landedUSD * 2.5 * 100) / 100,
      stretchUSD: Math.round(landed.landedUSD * 3.0 * 100) / 100,
      aiSuggestedLaunch: aiLaunchRaw,
      appliedLaunch: launch,
      marginPct,
      clampReason,
    };
  }

  return {
    recommended: ladder[0], // launch is the default applied tier
    ladder,
    comps,
    marketSaturated,
    notes,
    generatedAt: new Date().toISOString(),
    model: PRICING_MODEL,
    ...(perVariantPricing ? { perVariantPricing } : {}),
    ...(landedCostBreakdown ? { landedCostBreakdown } : {}),
  };
}
