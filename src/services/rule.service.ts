/**
 * Rule application service.
 *
 * Loads enabled `TransformationRule` rows from the DB for a given category,
 * passes the product context to Claude, and persists the result to the
 * appropriate column(s):
 *
 *   title       → Product.title
 *   description → Product.descriptionHtml
 *   tags        → Product.tags (CSV)
 *   image       → for each ProductImage: fileName + altText
 *   seo         → Product.metaDescription
 *
 * Each rule's `config` JSON is `{ model?: string; prompt: string }`. Rules
 * with `enabled: false` are skipped. When two or more rules share a category,
 * they run sequentially; later rules see earlier rules' output (the product
 * is re-read between rules so callers don't need to thread state).
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import { claudeJSON, claudeText, isClaudeConfigured } from "@/lib/ai/claude-client";
import { openaiJSON, openaiText, isOpenAIConfigured } from "@/lib/ai/openai-client";
import type { ScrapeOptions } from "@/types/scrape-options";
import { DEFAULT_SCRAPE_OPTIONS } from "@/types/scrape-options";
import type { ProductContext } from "@/types/product";

export type RuleCategory = "title" | "description" | "tags" | "image" | "seo";

const RULE_ORDER: RuleCategory[] = ["title", "description", "tags", "image", "seo"];

const DEFAULT_RULE_MODEL = "gpt-4.1-mini";

type Provider = "openai" | "claude";

/**
 * Dispatch a model id to its provider. `gpt-` → OpenAI, `claude-` → Anthropic,
 * anything else falls back to OpenAI (since the default is `gpt-4.1-mini`).
 */
function chooseProvider(model?: string): Provider {
  if (!model) return "openai";
  if (model.startsWith("gpt-")) return "openai";
  if (model.startsWith("claude-")) return "claude";
  return "openai";
}

function isProviderConfigured(provider: Provider): boolean {
  return provider === "openai" ? isOpenAIConfigured() : isClaudeConfigured();
}

/** Shape of a TransformationRule.config blob. */
interface RuleConfig {
  prompt: string;
  model?: string;
}

function parseRuleConfig(raw: string): RuleConfig | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuleConfig>;
    if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) return null;
    const config: RuleConfig = { prompt: parsed.prompt };
    if (typeof parsed.model === "string" && parsed.model.trim()) {
      config.model = parsed.model.trim();
    }
    return config;
  } catch {
    return null;
  }
}

/** Build the contextual user-message Claude sees alongside the rule prompt. */
function buildProductContextBlock(p: {
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string | null;
  descriptionHtml: string | null;
  optionNames: string | null;
  productContext: string | null;
}): string {
  const parts: string[] = [];
  parts.push(`Title: ${p.title}`);
  if (p.vendor) parts.push(`Vendor: ${p.vendor}`);
  if (p.productType) parts.push(`Product Type: ${p.productType}`);
  if (p.tags) parts.push(`Tags: ${p.tags}`);

  // Option axis names (parsed from JSON column).
  if (p.optionNames) {
    try {
      const arr = JSON.parse(p.optionNames);
      if (Array.isArray(arr) && arr.length > 0) {
        parts.push(`Variant axes: ${arr.join(" / ")}`);
      }
    } catch {
      // ignore
    }
  }

  // Extracted specs from Phase 2 enrichment.
  if (p.productContext) {
    try {
      const ctx = JSON.parse(p.productContext) as Partial<ProductContext>;
      if (Array.isArray(ctx.extractedSpecs) && ctx.extractedSpecs.length > 0) {
        const specLines = ctx.extractedSpecs
          .slice(0, 25)
          .map((s) => `  - ${s.name}: ${s.value}`)
          .join("\n");
        parts.push(`Specifications:\n${specLines}`);
      }
      if (Array.isArray(ctx.featureCallouts) && ctx.featureCallouts.length > 0) {
        parts.push(`Feature callouts:\n${ctx.featureCallouts.map((f) => `  - ${f}`).join("\n")}`);
      }
    } catch {
      // ignore
    }
  }

  // Description (truncated).
  if (p.descriptionHtml) {
    const text = p.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) {
      parts.push(`Description summary (first 800 chars):\n${text.slice(0, 800)}`);
    }
  }

  return parts.join("\n\n");
}

/** Format the live (non-hidden) variants for the description-rule prompt so
 * Claude only describes what the customer can actually buy. Curated-out
 * variants are deliberately omitted. */
function formatLiveVariantsForPrompt(
  variants: Array<{
    option1: string | null;
    option2: string | null;
    option3: string | null;
    price: string;
  }>,
): string {
  if (variants.length === 0) {
    return "Available variants: (none — single SKU)";
  }
  const lines = variants.map((v, i) => {
    const opts = [v.option1, v.option2, v.option3]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(" / ");
    return `  ${i + 1}. ${opts || "(default)"} — $${v.price}`;
  });
  return `Available variants (${variants.length} live SKU${variants.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}

/**
 * Load the user's currently-visible variants and format them as a prompt
 * block. Called by every per-category applier so the LLM sees what's
 * actually for sale (and refuses to mention features that were curated
 * out — e.g. don't put "LED" in the title if the LED variants are hidden).
 */
async function loadLiveVariantBlock(productId: string): Promise<string> {
  const liveVariants = await prisma.variant.findMany({
    where: { productId, isHidden: false },
    orderBy: { position: "asc" },
    select: { option1: true, option2: true, option3: true, price: true },
  });
  return formatLiveVariantsForPrompt(liveVariants);
}

/**
 * Strict reminder that goes after the variant block in every applier. Stops
 * the model from leaking supplier-side feature words ("LED", "USB-C",
 * "Cordless", etc.) into the title / tags / SEO / image alt text when those
 * features only existed in variants the user has since hidden.
 */
const STAY_INSIDE_VARIANTS_TRAILER = `CRITICAL — STAY INSIDE THE LIVE VARIANT SET:
The customer can ONLY buy what's listed above. Do NOT mention a feature, control type, light type, material variant, color, size, capacity, charging method, or option value that doesn't appear in that list. If a value comes from the supplier description (e.g. "LED", "USB-C", "Cordless", "Touch", "Dimmable") but isn't represented in any live variant, omit it from your output — the customer can't actually buy it.`;

/** Zod schema for `image` rule output — one entry per ProductImage. */
const ImageRuleResponseSchema = z.array(
  z.object({
    fileName: z.string().min(1),
    altText: z.string().min(1),
  }),
);

type ImageRuleResponse = z.infer<typeof ImageRuleResponseSchema>;

// ---------------------------------------------------------------------------
// Per-category appliers
// ---------------------------------------------------------------------------

async function applyTitleRules(
  productId: string,
  rules: Array<{ id: string; name: string; config: RuleConfig }>,
): Promise<void> {
  for (const rule of rules) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        optionNames: true,
        productContext: true,
      },
    });
    if (!product) return;

    const variantBlock = await loadLiveVariantBlock(productId);

    const userMessage = `${rule.config.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

${STAY_INSIDE_VARIANTS_TRAILER}

Return ONLY the new product title. No explanation, no surrounding quotes, no markdown.`;

    const model = rule.config.model || DEFAULT_RULE_MODEL;
    const provider = chooseProvider(model);
    if (!isProviderConfigured(provider)) continue;
    const newTitle =
      provider === "openai"
        ? await openaiText({
            model,
            user: userMessage,
            maxTokens: 256,
            temperature: 0.4,
          })
        : await claudeText({
            model,
            user: userMessage,
            maxTokens: 256,
            temperature: 0.4,
          });
    const cleaned = newTitle.replace(/^["']|["']$/g, "").trim();
    if (cleaned) {
      await prisma.product.update({
        where: { id: productId },
        data: { title: cleaned },
      });
    }
  }
}

async function applyDescriptionRules(
  productId: string,
  rules: Array<{ id: string; name: string; config: RuleConfig }>,
): Promise<void> {
  for (const rule of rules) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        optionNames: true,
        productContext: true,
      },
    });
    if (!product) return;

    // Live (non-hidden) variants — the description must reflect ONLY what
    // we're actually selling. Curated-out variants (isHidden=true) must NOT
    // appear in the rewritten description.
    const liveVariants = await prisma.variant.findMany({
      where: { productId, isHidden: false },
      orderBy: { position: "asc" },
      select: {
        option1: true,
        option2: true,
        option3: true,
        price: true,
      },
    });

    const variantBlock = formatLiveVariantsForPrompt(liveVariants);

    const userMessage = `${rule.config.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

CRITICAL: The description must describe ONLY the variants in the "Available variants" list above. Do NOT mention features, options, sizes, modes, or finishes that aren't represented in that list (e.g. if a charging mode, size, or color was curated out, do NOT describe it). The customer can ONLY buy what's listed.

REQUIRED SECTIONS — your output MUST include EVERY ONE of these, in this exact order, even if you have to be brief in places:
  1. The H2 product-type heading + three paragraphs + the "What's Included" block (per the rule's === DESCRIPTION TAB === section).
  2. <h3>Benefits</h3> with 3–5 benefit entries in the strict <p><strong>Title</strong><br>plain-text sentence</p> format.
  3. <h3>Specifications</h3> with a <table> listing every spec.
  4. <h3>FAQ</h3> with 3–4 entries in the strict <p><strong>Question?</strong><br>plain-text answer</p> format.

Before responding, re-read the rule above and confirm all four sections are present in your output. The output is INVALID if any section is missing.

Return ONLY the new descriptionHtml as defined by the rule above. No <html>/<body> wrapper, no markdown fences, no commentary.`;

    const model = rule.config.model || DEFAULT_RULE_MODEL;
    const provider = chooseProvider(model);
    if (!isProviderConfigured(provider)) continue;
    // 8192 tokens: the new description rule asks for 300-500 words plus a
    // <table>, Benefits block, FAQ block — comfortably under 8K but the old
    // 4096 cap was prone to mid-FAQ truncation.
    const newHtml =
      provider === "openai"
        ? await openaiText({
            model,
            user: userMessage,
            maxTokens: 8192,
            temperature: 0.5,
          })
        : await claudeText({
            model,
            user: userMessage,
            maxTokens: 8192,
            temperature: 0.5,
          });
    if (newHtml.trim()) {
      await prisma.product.update({
        where: { id: productId },
        data: { descriptionHtml: newHtml.trim() },
      });
    }
  }
}

async function applyTagsRules(
  productId: string,
  rules: Array<{ id: string; name: string; config: RuleConfig }>,
): Promise<void> {
  for (const rule of rules) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        optionNames: true,
        productContext: true,
      },
    });
    if (!product) return;

    const variantBlock = await loadLiveVariantBlock(productId);

    const userMessage = `${rule.config.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

${STAY_INSIDE_VARIANTS_TRAILER}

Return ONLY a comma-separated list of tags (no surrounding quotes, no markdown, no leading "Tags:" prefix).`;

    const model = rule.config.model || DEFAULT_RULE_MODEL;
    const provider = chooseProvider(model);
    if (!isProviderConfigured(provider)) continue;
    const raw =
      provider === "openai"
        ? await openaiText({
            model,
            user: userMessage,
            maxTokens: 512,
            temperature: 0.5,
          })
        : await claudeText({
            model,
            user: userMessage,
            maxTokens: 512,
            temperature: 0.5,
          });
    const tags = raw
      .split(/[,\n]/)
      .map((t) => t.replace(/^[\s"'-]+|[\s"']+$/g, "").trim())
      .filter((t) => t.length > 0 && t.length <= 60);

    if (tags.length > 0) {
      await prisma.product.update({
        where: { id: productId },
        data: { tags: tags.join(", ") },
      });
    }
  }
}

async function applySeoRules(
  productId: string,
  rules: Array<{ id: string; name: string; config: RuleConfig }>,
): Promise<void> {
  for (const rule of rules) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        optionNames: true,
        productContext: true,
      },
    });
    if (!product) return;

    const variantBlock = await loadLiveVariantBlock(productId);

    const userMessage = `${rule.config.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

${STAY_INSIDE_VARIANTS_TRAILER}

Return ONLY the new meta description, max 160 characters. No surrounding quotes, no markdown, no commentary.`;

    const model = rule.config.model || DEFAULT_RULE_MODEL;
    const provider = chooseProvider(model);
    if (!isProviderConfigured(provider)) continue;
    const meta =
      provider === "openai"
        ? await openaiText({
            model,
            user: userMessage,
            maxTokens: 256,
            temperature: 0.4,
          })
        : await claudeText({
            model,
            user: userMessage,
            maxTokens: 256,
            temperature: 0.4,
          });
    const cleaned = meta.replace(/^["']|["']$/g, "").trim().slice(0, 320);
    if (cleaned) {
      await prisma.product.update({
        where: { id: productId },
        data: { metaDescription: cleaned },
      });
    }
  }
}

async function applyImageRules(
  productId: string,
  rules: Array<{ id: string; name: string; config: RuleConfig }>,
): Promise<void> {
  for (const rule of rules) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        title: true,
        vendor: true,
        productType: true,
        tags: true,
        descriptionHtml: true,
        optionNames: true,
        productContext: true,
      },
    });
    if (!product) return;

    const images = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        fileName: true,
        altText: true,
      },
    });
    if (images.length === 0) continue;

    const imageList = images
      .map(
        (img) =>
          `  ${img.position}. id=${img.id} | current fileName=${img.fileName ?? "(none)"} | current altText=${img.altText ?? "(none)"}`,
      )
      .join("\n");

    const variantBlock = await loadLiveVariantBlock(productId);

    const userMessage = `${rule.config.prompt}

Product context:
${buildProductContextBlock(product)}

${variantBlock}

${STAY_INSIDE_VARIANTS_TRAILER}

You will rename ${images.length} product image(s). Return a JSON array with EXACTLY ${images.length} entries, in the same order as listed below:

${imageList}

Each entry MUST match this shape:
[
  { "fileName": "<filename per the rule above>", "altText": "<alt text per the rule above>" },
  ...
]

Follow the rule above for filename format, length, and the level of descriptive detail expected. Return ONLY the JSON array — no markdown fences, no commentary.`;

    const model = rule.config.model || DEFAULT_RULE_MODEL;
    const provider = chooseProvider(model);
    if (!isProviderConfigured(provider)) continue;

    let response: ImageRuleResponse;
    try {
      response =
        provider === "openai"
          ? await openaiJSON({
              model,
              user: userMessage,
              maxTokens: 4096,
              temperature: 0.4,
              schema: ImageRuleResponseSchema,
            })
          : await claudeJSON({
              model,
              user: userMessage,
              maxTokens: 4096,
              temperature: 0.4,
              schema: ImageRuleResponseSchema,
            });
    } catch {
      continue; // skip this rule on parse failure
    }

    const updates: Array<Promise<unknown>> = [];
    for (let i = 0; i < images.length && i < response.length; i++) {
      const entry = response[i];
      updates.push(
        prisma.productImage.update({
          where: { id: images[i].id },
          data: {
            fileName: entry.fileName,
            altText: entry.altText,
          },
        }),
      );
    }
    if (updates.length > 0) {
      await Promise.all(updates);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadRulesForCategory(
  category: RuleCategory,
  userId: string | null,
): Promise<Array<{ id: string; name: string; config: RuleConfig }>> {
  const rows = await prisma.transformationRule.findMany({
    where: {
      category,
      enabled: true,
      ...(userId ? { userId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const parsed: Array<{ id: string; name: string; config: RuleConfig }> = [];
  for (const row of rows) {
    const cfg = parseRuleConfig(row.config);
    if (!cfg) continue;
    parsed.push({ id: row.id, name: row.name, config: cfg });
  }
  return parsed;
}

/**
 * Apply every enabled rule in a single category to a product. No-op when:
 *   - the category toggle in ScrapeOptions is false
 *   - no matching enabled rules exist
 *   - Anthropic is not configured
 */
export async function applyRulesByCategory(
  productId: string,
  category: RuleCategory,
  options: ScrapeOptions,
): Promise<void> {
  if (!options.ruleToggles[category]) return;
  // Skip whole category only if NEITHER provider is configured. Per-rule
  // routing further down also skips individual rules whose chosen provider
  // is not configured.
  if (!isClaudeConfigured() && !isOpenAIConfigured()) return;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { userId: true },
  });
  if (!product) return;

  const rules = await loadRulesForCategory(category, product.userId);
  if (rules.length === 0) return;

  switch (category) {
    case "title":
      await applyTitleRules(productId, rules);
      break;
    case "description":
      await applyDescriptionRules(productId, rules);
      break;
    case "tags":
      await applyTagsRules(productId, rules);
      break;
    case "image":
      await applyImageRules(productId, rules);
      break;
    case "seo":
      await applySeoRules(productId, rules);
      break;
  }
}

/** Run all 5 categories in canonical order. */
export async function applyAllRules(
  productId: string,
  options: ScrapeOptions,
): Promise<void> {
  for (const category of RULE_ORDER) {
    await applyRulesByCategory(productId, category, options);
  }
}

/**
 * Re-apply rules on demand (e.g. the review page's "Re-apply rules" button).
 * Uses DEFAULT_SCRAPE_OPTIONS so every category runs. Pass `category` to
 * limit to a single category — useful right after running the hero/lifestyle
 * skills so the image-naming rule can refresh filenames/alt text without
 * rebuilding the whole description or pricing pass.
 */
export async function reapplyRules(
  productId: string,
  categories?: RuleCategory | RuleCategory[],
): Promise<void> {
  // No categories OR explicit empty array → run every category via the
  // single-pass applyAllRules path (cheaper than looping one-by-one).
  if (!categories || (Array.isArray(categories) && categories.length === 0)) {
    await applyAllRules(productId, DEFAULT_SCRAPE_OPTIONS);
    return;
  }
  // Single category (legacy callers passing a string) → one apply call.
  if (typeof categories === "string") {
    await applyRulesByCategory(productId, categories, DEFAULT_SCRAPE_OPTIONS);
    return;
  }
  // Multiple categories → run them sequentially. Each rule expects a fresh DB
  // state from the previous; serializing avoids write races on the same row.
  for (const cat of categories) {
    await applyRulesByCategory(productId, cat, DEFAULT_SCRAPE_OPTIONS);
  }
}
