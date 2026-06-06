export interface PricingTier {
  label: "launch" | "stretch" | "bundle" | "compareAt";
  price: number;
  reasoning: string;
}

export interface PricingComp {
  title: string;
  price: number;
  currency: string;
  url?: string;
  source?: string;
}

/**
 * Optional per-variant pricing block. When `mode === "uniform"` (the default,
 * matches legacy behavior), every variant gets the same anchor price scaled
 * by the same ratio. When `mode === "tiered"`, the LLM decided the variants
 * differ on a meaningful dimension (size, capacity, wattage, count) and wants
 * to spread prices accordingly. Each `tier` lists the variant positions that
 * belong to it and a multiplier applied to the chosen ladder tier's anchor.
 */
export interface AiPerVariantPricing {
  mode: "uniform" | "tiered";
  /** One-line rationale shown in the UI: e.g. "size axis with 3 sizes" or "color only — same price". */
  rationale: string;
  /** Present and non-empty only when mode === "tiered". */
  tiers?: Array<{
    label: string;
    /** 0-based positions of variants in this tier (mirrors Variant.position from the DB). */
    variantPositions: number[];
    /** Multiplier applied to the chosen ladder tier's anchor — typically 0.75 (smallest) to 1.6 (largest). */
    multiplier: number;
  }>;
}

/**
 * Landed cost + margin breakdown surfaced alongside the pricing ladder. Only
 * populated when the product had a parseable `rawPayload.price` (the scraped
 * CNY wholesale block). Used for both the AI prompt reference AND the
 * post-clamp audit trail so the user can see why a price moved.
 */
export interface LandedCostBreakdown {
  supplierCNY: number;
  supplierUSD: number;
  weightG: number;
  weightSource: "rawPayload" | "fallback-2kg";
  shippingUSD: number;
  landedUSD: number;
  /** landed × 2.0 — HARD MINIMUM, never recommend below */
  floorUSD: number;
  /** landed × 2.5 — preferred margin baseline */
  targetUSD: number;
  /** landed × 3.0 — upper if comps support */
  stretchUSD: number;
  /** What the AI returned for launch BEFORE the floor clamp. */
  aiSuggestedLaunch: number;
  /** Launch price after clamping (always ≥ floorUSD). */
  appliedLaunch: number;
  /** Gross margin % on the applied launch: (applied - landed) / applied × 100. */
  marginPct: number;
  clampReason:
    | "ai-above-floor"
    | "floored-up"
    | "fallback-no-landed";
}

export interface AiPricingRationale {
  recommended: PricingTier;
  ladder: PricingTier[];
  comps: PricingComp[];
  marketSaturated: boolean;
  notes: string;
  generatedAt: string;
  model: string;
  /** Optional — when present, drives per-variant pricing in `applyPricingToVariants`. */
  perVariantPricing?: AiPerVariantPricing;
  /** Optional — only present when rawPayload supplied a parseable CNY price. */
  landedCostBreakdown?: LandedCostBreakdown;
}
