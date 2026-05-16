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
import { getClaudeClient, isClaudeConfigured } from "@/lib/ai/claude-client";
import type {
  AiPricingRationale,
  PricingComp,
  PricingTier,
} from "@/types/pricing-rationale";
import type { ScrapedProduct } from "@/types/product";
import type { ScrapeOptions } from "@/types/scrape-options";

const PRICING_MODEL = "claude-haiku-4-5";

export { isClaudeConfigured };

function buildPricingPrompt(input: {
  productTitle: string;
  productType: string | null;
  sourceCost: number;
  sourceCurrency: string;
  targetCurrency: string;
  storePositioning?: "value" | "mid" | "premium";
}): string {
  const positioning = input.storePositioning ?? "mid";
  const typeLine = input.productType
    ? `- Type: ${input.productType}`
    : `- Type: (unspecified — infer from title)`;
  return `You are pricing a product for a Shopify dropshipping store using the "luxury but fair" methodology. Use the web_search tool to find real comparable products before deciding the price ladder.

PRODUCT
- Title: ${input.productTitle}
${typeLine}
- Source cost: ${input.sourceCost.toFixed(2)} ${input.sourceCurrency}
- Target sell currency: ${input.targetCurrency}
- Store positioning hint: ${positioning}

STEPS — execute and return structured JSON matching the schema below.

1. ONE-LINE READ — what makes this product different from generic peers (1 sentence).

2. ANCHOR PRICES — search the web for 4–7 comparable products across three tiers:
   - "boutique" (West Elm, Schoolhouse, Cedar & Moss, Visual Comfort, RBW, Allied Maker, Pottery Barn, Crate & Barrel premium lines, Anthropologie home, Hawkins NY, Grizzly Pro, Powermatic for tools)
   - "mainstream" (Wayfair branded, Crate & Barrel entry, Amazon best-sellers with strong reviews, Rikon, Laguna for tools)
   - "floor" (Amazon generic, AliExpress, Temu equivalent)
   For each comp: brand, product (if known), price (string with currency symbol), url (real Search result URL or omit).

3. SATURATION CHECK — search TikTok / Amazon / AliExpress / Temu for the same silhouette and return a "high" | "medium" | "low" flag.

4. PRICING LADDER — derive four numbers in ${input.targetCurrency}:
   - launch = mainstream-mid minus 20–35% trust deficit, rounded to a psychology breakpoint
     (49 / 79 / 99 / 129 / 149 / 179 / 199 / 229 / 249 / 279 / 299 / 349 / 399 / 449 / 499 / 599 / 699 / 799 / 899 / 999 / 1199 / 1499 / 1799 / 1999 / 2499 / 2999)
   - stretch = launch + one breakpoint up
   - bundle = stretch + 5–15
   - compareAt = launch × 1.30 to 1.45, rounded to a clean number

5. NOTES — write a SINGLE short paragraph (2–3 sentences MAX, ≤ 60 words total) summarizing your read of this product and why the launch price lands where it does. Reference the strongest single signal (saturation level, comp tier, or material/aesthetic lift). Plain text. NO headings, NO bullets, NO multi-paragraph essays.

HARD RULES:
- Saturation = "high" caps the ladder at the LOWER end of the trust-adjusted band — do not push above mainstream-mid minus 25%.
- Launch must always be >= sourceCost converted to ${input.targetCurrency} × 1.5 (viability floor).
- Never invent a comp. If a tier has no real Search comps, return an empty array for it — do not fabricate URLs.

Return ONLY valid JSON, no markdown fences, no commentary, matching this schema EXACTLY:
{
  "comps": [{ "tier": "boutique"|"mainstream"|"floor", "brand": "string", "product": "string?", "price": "string", "url": "string?" }],
  "saturation": "low"|"medium"|"high",
  "ladder": { "launch": number, "stretch": number, "bundle": number, "compareAt": number },
  "notes": "string (2-3 sentences, ≤60 words, plain text — see step 5)"
}`;
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

  const prompt = buildPricingPrompt({
    productTitle: product.title,
    productType: product.productType ?? null,
    sourceCost,
    sourceCurrency,
    targetCurrency,
  });

  // We use the SDK directly here (not claudeText) because we need to pass the
  // `tools` parameter for web_search — the shared `claudeText()` helper doesn't
  // expose tools.
  const client = getClaudeClient();
  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
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
    });
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

  // Enforce viability floor: launch >= sourceCost × 1.5
  const minLaunch = sourceCost * 1.5;
  const launch = Math.max(parsed.ladder.launch, minLaunch);
  const stretch = Math.max(parsed.ladder.stretch, launch);
  const bundle = Math.max(parsed.ladder.bundle, stretch);
  const compareAt = Math.max(parsed.ladder.compareAt, minLaunch * 1.3);

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

  return {
    recommended: ladder[0], // launch is the default applied tier
    ladder,
    comps,
    marketSaturated,
    notes,
    generatedAt: new Date().toISOString(),
    model: PRICING_MODEL,
  };
}
