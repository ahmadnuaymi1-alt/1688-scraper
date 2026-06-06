/**
 * Pricing strategy service.
 *
 * Wraps the Claude-backed `suggestPricingStrategy` (web-search + structured
 * rationale) with the two operations the rest of the app needs:
 *
 *   - `recalculatePricing()`      — fetch the product + variants from the DB,
 *                                   call the AI, persist the rationale onto
 *                                   `Product.pricingNotes`, and return it.
 *   - `applyPricingToVariants()` — given a chosen tier ("launch" / "stretch"
 *                                  / "bundle"), update every Variant.price +
 *                                  compareAtPrice using the multipliers and
 *                                  rounding mode from ScrapeOptions.
 *   - `roundPrice()`             — small numeric helper for the 5 rounding
 *                                  modes (".95" | ".99" | "5.00" | "9" | "none").
 */

import { prisma } from "@/lib/db";
import { suggestPricingStrategy } from "@/lib/ai/claude-pricing-client";
import type { AiPricingRationale, PricingTier } from "@/types/pricing-rationale";
import type { ScrapedProduct, ScrapedVariant } from "@/types/product";
import type { ScrapeOptions } from "@/types/scrape-options";

/**
 * Round a price string/number into one of the four supported rounding modes.
 * Always returns a 2-decimal string (e.g. "29.95") regardless of mode — the
 * suffix-based modes adjust the integer/fractional split, then we re-format.
 */
export function roundPrice(
  price: number | string,
  mode: ScrapeOptions["priceRounding"],
): string {
  const n = typeof price === "number" ? price : parseFloat(price);
  if (!Number.isFinite(n) || n <= 0) return "0.00";

  switch (mode) {
    case "none":
      return n.toFixed(2);
    case ".95": {
      const floored = Math.floor(n);
      // If the original was already at or above x.95, bump to next dollar's .95
      const candidate = floored + 0.95;
      const result = candidate < n - 0.001 ? floored + 1 + 0.95 : candidate;
      return result.toFixed(2);
    }
    case ".99": {
      const floored = Math.floor(n);
      const candidate = floored + 0.99;
      const result = candidate < n - 0.001 ? floored + 1 + 0.99 : candidate;
      return result.toFixed(2);
    }
    case "5.00": {
      // Round to the nearest multiple of 5, biased upward
      const rounded = Math.ceil(n / 5) * 5;
      return rounded.toFixed(2);
    }
    case "9": {
      // Round to the nearest whole dollar ending in 9 (e.g. 24.30 → 29,
      // 33 → 29, 87 → 89). Floor at 9 so tiny prices snap up to $9.
      const rounded = Math.max(9, Math.round((n - 9) / 10) * 10 + 9);
      return rounded.toFixed(2);
    }
    case "4or9": {
      // Round to the nearest whole dollar ending in 4 or 9 — the two $5-apart
      // psychological breakpoints (…, 24, 29, 34, 39, …). e.g. 296.95 → 299,
      // 471.95 → 474, 23 → 24, 27 → 29. Floor at 4 so tiny prices snap up.
      const rounded = Math.max(4, Math.round((n + 1) / 5) * 5 - 1);
      return rounded.toFixed(2);
    }
    default:
      return n.toFixed(2);
  }
}

/**
 * Smallest whole dollar ending in 4 or 9 that is >= n. Used to snap a hard
 * floor UP to a clean $4/$9 breakpoint — rounding to the NEAREST breakpoint
 * could land just below the floor, so the floor clamp needs a ceil variant.
 */
function roundUpTo4or9(n: number): number {
  return Math.max(4, Math.ceil((n + 1) / 5) * 5 - 1);
}

/**
 * Build a minimal `ScrapedProduct`-shaped object from a DB product + its
 * variants. We only need the fields suggestPricingStrategy() looks at.
 */
function dbProductToScrapedShape(
  product: {
    id: string;
    title: string;
    handle: string;
    productType: string | null;
    rawPayload: string;
  },
  variants: Array<{
    title: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    price: string;
    supplierCost: string | null;
    position: number;
  }>,
): ScrapedProduct {
  const scrapedVariants: ScrapedVariant[] = variants.map((v) => ({
    title: v.title,
    option1: v.option1 ?? undefined,
    option2: v.option2 ?? undefined,
    option3: v.option3 ?? undefined,
    price: v.price,
    supplierCost: v.supplierCost ?? undefined,
    position: v.position,
  }));

  return {
    sourceUrl: "",
    sourcePlatform: "1688",
    title: product.title,
    handle: product.handle,
    productType: product.productType ?? undefined,
    optionNames: [],
    variants: scrapedVariants,
    images: [],
    // Pass the rawPayload string through so suggestPricingStrategy() can
    // compute landed cost from the original CNY-tagged supplier wholesale.
    rawPayload: product.rawPayload,
  };
}

/**
 * Generate a fresh pricing rationale for a product and persist it to
 * `Product.pricingNotes` as JSON. Throws if the product is missing or AI is
 * unavailable.
 */
export async function recalculatePricing(
  productId: string,
  options: ScrapeOptions,
): Promise<AiPricingRationale> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: {
        orderBy: { position: "asc" },
      },
    },
  });
  if (!product) {
    throw new Error(`recalculatePricing: product ${productId} not found`);
  }

  const scrapedShape = dbProductToScrapedShape(product, product.variants);
  const rationale = await suggestPricingStrategy(scrapedShape, options);

  await prisma.product.update({
    where: { id: productId },
    data: { pricingNotes: JSON.stringify(rationale) },
  });

  return rationale;
}

/**
 * Pick a tier out of an `AiPricingRationale.ladder` by label. Returns null
 * when the requested tier doesn't exist on the ladder.
 */
function findTier(
  rationale: AiPricingRationale,
  label: PricingTier["label"],
): PricingTier | null {
  return rationale.ladder.find((t) => t.label === label) ?? null;
}

/**
 * Apply a chosen tier to all variants of a product. Reads
 * `Product.pricingNotes`, computes anchor + compareAt prices using the
 * multipliers + rounding mode from `ScrapeOptions`, and writes the result back
 * to each Variant.
 *
 * Strategy:
 *   - newAnchor = tier.price × ScrapeOptions.retailPriceMultiplier
 *   - Final prices are ALWAYS rounded to the nearest $4/$9 breakpoint and a
 *     compare-at price is NEVER set (any existing compareAt is cleared). This
 *     is a user standing rule for AI-suggested prices and is enforced here
 *     regardless of options.priceRounding / options.omitCompareAtPrice.
 *   - Variants that had a price differential from the original supplier keep
 *     their relative spread — i.e. the second variant scales by the same ratio
 *     as the first.
 */
export async function applyPricingToVariants(
  productId: string,
  tier: "launch" | "stretch" | "bundle",
  options: ScrapeOptions,
): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, pricingNotes: true },
  });
  if (!product) {
    throw new Error(`applyPricingToVariants: product ${productId} not found`);
  }
  if (!product.pricingNotes) {
    throw new Error(
      `applyPricingToVariants: product ${productId} has no pricingNotes — run recalculatePricing first`,
    );
  }

  let rationale: AiPricingRationale;
  try {
    rationale = JSON.parse(product.pricingNotes) as AiPricingRationale;
  } catch (err) {
    throw new Error(
      `applyPricingToVariants: failed to parse pricingNotes JSON (${err instanceof Error ? err.message : err})`,
    );
  }

  const chosenTier = findTier(rationale, tier);
  if (!chosenTier) {
    throw new Error(`applyPricingToVariants: tier "${tier}" not found in ladder`);
  }
  const variants = await prisma.variant.findMany({
    where: { productId },
    orderBy: { position: "asc" },
  });
  if (variants.length === 0) return;

  const retailMul = Number.isFinite(options.retailPriceMultiplier)
    ? options.retailPriceMultiplier
    : 1;

  const newAnchor = chosenTier.price * retailMul;
  // AI-suggested pricing NEVER sets a compare-at price (user's standing rule),
  // so compareAt is always null regardless of options — and any existing
  // compareAtPrice on a variant is cleared by the write below.
  const newCompareAt: number | null = null;

  // Per-variant pricing: when the LLM said variants differ enough to warrant
  // tiered pricing (e.g. small / medium / large), build a position → multiplier
  // map. Variants in different tiers will land on different final prices.
  // Variants not assigned to any tier (or all variants when mode === "uniform"
  // or perVariantPricing is absent) get multiplier 1.0 — the legacy behavior.
  const pvp = rationale.perVariantPricing;
  const isTiered = pvp?.mode === "tiered";
  const multByPosition = new Map<number, number>();
  if (pvp?.mode === "tiered" && Array.isArray(pvp.tiers)) {
    for (const tier of pvp.tiers) {
      for (const pos of tier.variantPositions) {
        multByPosition.set(pos, tier.multiplier);
      }
    }
  }

  // Compute baseline from the first variant's existing price for spread
  // preservation. If parseable & > 0 we scale all variants proportionally.
  const baseline = parseFloat(variants[0].price);
  const useRatio = Number.isFinite(baseline) && baseline > 0;
  const ratio = useRatio ? newAnchor / baseline : 0;
  const compareRatio = useRatio && newCompareAt !== null ? newCompareAt / baseline : 0;

  // Per-variant hard 2x-landed floor. The base/launch price already clears this,
  // but a small-size multiplier (<1) could push the smallest variant under it —
  // so EVERY variant is clamped up to it. Null when landed cost couldn't be
  // computed (no rawPayload), in which case no per-variant clamp is applied.
  const floorUSD = rationale.landedCostBreakdown?.floorUSD ?? null;

  const updates = variants.map((v) => {
    const tierMultiplier = multByPosition.get(v.position) ?? 1;
    const oldPrice = parseFloat(v.price);
    let priceNum: number;
    if (isTiered) {
      // Tiered: the size multiplier ALREADY encodes the size differentiation,
      // so apply it to the anchor directly. Do NOT also scale by the supplier
      // price spread — doing both double-counts size and the largest variant
      // overshoots the comp band (e.g. a $379 anchor ballooning to $689).
      priceNum = newAnchor * tierMultiplier;
    } else if (useRatio && Number.isFinite(oldPrice) && oldPrice > 0) {
      // Uniform: preserve the supplier's relative price spread across variants.
      priceNum = oldPrice * ratio;
    } else {
      priceNum = newAnchor;
    }
    // Forced to the $4/$9 breakpoint (user's standing rule), then clamped up to
    // the hard 2x-landed floor so NO variant — not even the smallest size — can
    // ever fall below 2x cost.
    let finalNum = parseFloat(roundPrice(priceNum, "4or9"));
    if (floorUSD != null && finalNum < floorUSD) finalNum = roundUpTo4or9(floorUSD);
    const newPrice = finalNum.toFixed(2);

    let newCompareAtStr: string | null = null;
    if (newCompareAt !== null) {
      let cmpNum: number;
      const oldCmp = v.compareAtPrice ? parseFloat(v.compareAtPrice) : NaN;
      if (useRatio && Number.isFinite(oldCmp) && oldCmp > 0) {
        // Scale existing compareAt by the same ratio used for price
        cmpNum = oldCmp * ratio;
      } else if (useRatio && Number.isFinite(oldPrice) && oldPrice > 0) {
        // Use compareAt-specific ratio off the price ladder
        cmpNum = oldPrice * compareRatio;
      } else {
        cmpNum = newCompareAt;
      }
      // Per-variant tier multiplier applies to compareAt too, so the
      // promotional "strike-through" reads consistently with the live price.
      cmpNum *= tierMultiplier;
      newCompareAtStr = roundPrice(cmpNum, options.priceRounding);
    }

    return prisma.variant.update({
      where: { id: v.id },
      data: { price: newPrice, compareAtPrice: newCompareAtStr },
    });
  });

  await Promise.all(updates);
}
