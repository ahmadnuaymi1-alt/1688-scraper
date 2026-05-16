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

export interface AiPricingRationale {
  recommended: PricingTier;
  ladder: PricingTier[];
  comps: PricingComp[];
  marketSaturated: boolean;
  notes: string;
  generatedAt: string;
  model: string;
}
