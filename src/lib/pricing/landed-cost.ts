/**
 * Landed cost helper. Reads `Product.rawPayload` (the scraped 1688 JSON
 * blob), pulls the CNY supplier wholesale + weight, converts to USD, adds
 * a weight-bracket shipping estimate, and returns the breakdown.
 *
 * Bypasses `Variant.supplierCost` — that field is currency-corrupted (scraper
 * drops the CNY tag when populating it, so downstream code treats "250.00"
 * as USD when it's really ¥250). The rawPayload preserves the currency tag.
 *
 * Returns null when rawPayload is unparseable or has no usable price — the
 * caller falls back to current behavior in that case (no landed reference,
 * no clamp).
 */

/** CNY to USD spot rate. Update manually if the rate shifts by ≥5%. */
const CNY_TO_USD = 7.1;

/**
 * Weight-bracket shipping from 1688 supplier → US, derived from Yun Express
 * / 4PX / ePacket published rates. See [pricing-methodology] memory for
 * derivation. Returns USD per unit.
 */
function shippingUsdFromWeightG(weightG: number): number {
  if (weightG <= 500) return 8;
  if (weightG <= 1000) return 14;
  if (weightG <= 2000) return 26;
  if (weightG <= 3000) return 40;
  if (weightG <= 5000) return 60;
  if (weightG <= 10000) return 100;
  if (weightG <= 20000) return 180;
  return 250 + Math.round(((weightG - 20000) / 1000) * 5);
}

export interface LandedCostBreakdown {
  supplierCNY: number;
  supplierUSD: number;
  weightG: number;
  /** "rawPayload" when productWeightG was present and plausible; "fallback-2kg"
   * when missing or implausibly small (<100g for a non-trivial item) so the
   * helper used a 2 kg category default. The caller should flag this in the
   * audit trail so the user can verify. */
  weightSource: "rawPayload" | "fallback-2kg";
  shippingUSD: number;
  landedUSD: number;
}

interface RawPayloadPriceBlock {
  min?: number;
  max?: number;
  currency?: string;
}

interface MinimalRawPayload {
  price?: RawPayloadPriceBlock;
  productWeightG?: number;
}

/**
 * Parse rawPayload JSON and compute landed cost. Returns null when:
 *   - JSON parse fails
 *   - price block missing or price.min not a positive number
 *
 * Implausibly small weights (under 100g for a non-trivially-sized fixture)
 * trigger the 2 kg fallback. The scraper's page-state parser occasionally
 * grabs the wrong field for weight (we've seen 1g, 17g, 60g on real outdoor
 * sconces) — the fallback keeps the landed math honest in those cases.
 */
export function computeLandedFromRawPayload(
  rawPayload: string,
): LandedCostBreakdown | null {
  let parsed: MinimalRawPayload;
  try {
    parsed = JSON.parse(rawPayload) as MinimalRawPayload;
  } catch {
    return null;
  }
  const supplierCNY = parsed.price?.min;
  if (typeof supplierCNY !== "number" || !Number.isFinite(supplierCNY) || supplierCNY <= 0) {
    return null;
  }
  const supplierUSD = supplierCNY / CNY_TO_USD;

  const rawWeightG = parsed.productWeightG;
  let weightG: number;
  let weightSource: "rawPayload" | "fallback-2kg";
  if (
    typeof rawWeightG === "number" &&
    Number.isFinite(rawWeightG) &&
    rawWeightG >= 100
  ) {
    weightG = rawWeightG;
    weightSource = "rawPayload";
  } else {
    weightG = 2000;
    weightSource = "fallback-2kg";
  }

  const shippingUSD = shippingUsdFromWeightG(weightG);
  const landedUSD = supplierUSD + shippingUSD;

  return {
    supplierCNY,
    supplierUSD: Math.round(supplierUSD * 100) / 100,
    weightG,
    weightSource,
    shippingUSD,
    landedUSD: Math.round(landedUSD * 100) / 100,
  };
}
