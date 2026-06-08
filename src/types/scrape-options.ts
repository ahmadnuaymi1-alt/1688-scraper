import { z } from "zod";

export const RuleTogglesSchema = z.object({
  title: z.boolean().default(true),
  description: z.boolean().default(true),
  tags: z.boolean().default(true),
  image: z.boolean().default(true),
  seo: z.boolean().default(true),
});

export const DefaultInventorySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("random"), min: z.number().int().min(0), max: z.number().int().min(0) }),
  z.object({ type: z.literal("fixed"), value: z.number().int().min(0) }),
]);

export const ScrapeOptionsSchema = z.object({
  ruleToggles: RuleTogglesSchema.default({
    title: true,
    description: true,
    tags: true,
    image: true,
    seo: true,
  }),

  autoCurateVariants: z.boolean().default(false),
  suggestedPricing: z.boolean().default(false),

  vendor: z.string().optional(),
  productType: z.string().optional(),
  extraTags: z.string().optional(),
  languageVariant: z.string().default("en-US"),
  productStatus: z.enum(["draft", "active"]).default("draft"),

  sourceCurrency: z.enum(["auto", "USD", "CNY", "GBP", "EUR"]).default("auto"),
  priceRounding: z.enum(["none", ".95", ".99", "5.00", "9", "4or9"]).default("4or9"),
  retailPriceMultiplier: z.number().default(1.0),
  compareAtPriceMultiplier: z.number().default(1.0),
  costPerItem: z.string().optional(),
  omitCompareAtPrice: z.boolean().default(true),

  defaultInventory: DefaultInventorySchema.default({ type: "random", min: 10, max: 50 }),
  inventoryPolicy: z.enum(["continue", "deny"]).default("deny"),
  publishToAllChannels: z.boolean().default(true),
  generateSku: z.boolean().default(true),

  autoUpload: z.boolean().default(false),
  uploadConnectionId: z.string().optional(),
  templateSuffix: z.string().optional(),
});

export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;
export type RuleToggles = z.infer<typeof RuleTogglesSchema>;
export type DefaultInventory = z.infer<typeof DefaultInventorySchema>;

export const DEFAULT_SCRAPE_OPTIONS: ScrapeOptions = ScrapeOptionsSchema.parse({});
