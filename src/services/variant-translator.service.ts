/**
 * Variant Translator Service.
 *
 * Translates Chinese option-axis names + values to English using Claude Haiku
 * 4.5 in a single batched call. Mutates the passed `ScrapedProduct` in place
 * (assigning translated values to `option1/2/3` + `optionNames`) and preserves
 * the original Chinese on `supplierLabel1/2/3` as an audit trail.
 *
 * Bails out (returns the product unchanged) when no Chinese characters are
 * detected anywhere in the option axes — saves an API call on already-English
 * products.
 */

import { z } from "zod";
import { claudeJSON, isClaudeConfigured } from "@/lib/ai/claude-client";
import type { ScrapedProduct } from "@/types/product";

const MODEL = "claude-haiku-4-5";

/**
 * CJK Unified Ideographs (0x4E00–0x9FFF) covers the vast majority of Chinese
 * characters. Also include the CJK extensions A (0x3400–0x4DBF) for
 * less-common ideographs that occasionally appear in product specs.
 */
const CHINESE_REGEX = /[㐀-䶿一-鿿]/;

function hasChinese(s: string | null | undefined): boolean {
  return !!s && CHINESE_REGEX.test(s);
}

const TranslationResponseSchema = z.object({
  axisNames: z.array(z.string()),
  values: z.record(z.string(), z.record(z.string(), z.string())),
});

type TranslationResponse = z.infer<typeof TranslationResponseSchema>;

/**
 * Translate Chinese option-axis names + values on a `ScrapedProduct` to
 * English using Claude Haiku 4.5. Returns the same product reference, with
 * `option1/2/3` + `optionNames` rewritten in place; the original Chinese is
 * preserved on `supplierLabel1/2/3`.
 *
 * No-ops (returns unchanged) when:
 *   - Anthropic is not configured
 *   - No Chinese characters are detected anywhere in optionNames or option1/2/3
 *   - There are no variants
 */
export async function translateVariantsToEnglish(
  product: ScrapedProduct,
): Promise<ScrapedProduct> {
  if (!isClaudeConfigured()) return product;
  if (!product.variants || product.variants.length === 0) return product;

  // Bail out if nothing looks Chinese
  const hasChineseInAxes = product.optionNames.some(hasChinese);
  const hasChineseInValues = product.variants.some(
    (v) => hasChinese(v.option1) || hasChinese(v.option2) || hasChinese(v.option3),
  );
  if (!hasChineseInAxes && !hasChineseInValues) {
    return product;
  }

  // Collect unique values per axis (using the original Chinese as keys).
  const axisCount = Math.min(product.optionNames.length, 3);
  const axisLabels: string[] = [];
  const uniqueValuesPerAxis: Array<Set<string>> = [];
  for (let i = 0; i < axisCount; i++) {
    axisLabels.push(product.optionNames[i] ?? `Option ${i + 1}`);
    uniqueValuesPerAxis.push(new Set<string>());
  }
  for (const v of product.variants) {
    for (let i = 0; i < axisCount; i++) {
      const slot = `option${i + 1}` as "option1" | "option2" | "option3";
      const val = v[slot];
      if (val) uniqueValuesPerAxis[i].add(val);
    }
  }

  // Build the prompt
  const valuesBlock = axisLabels
    .map((label, i) => {
      const vals = Array.from(uniqueValuesPerAxis[i]);
      return `Axis ${i + 1} — "${label}":\n${vals.map((v) => `  - ${v}`).join("\n")}`;
    })
    .join("\n\n");

  const systemPrompt = `You translate Chinese e-commerce variant labels (option axis names and option values) into natural, customer-friendly English suitable for a Western Shopify storefront. Be concise — keep values short and scannable. Don't transliterate pinyin; translate the meaning. Title Case for axis names. Sentence case for values. For dimensions (e.g. "30厘米"), use a space between number and unit ("30 cm"). Brand-name materials (linen, walnut, brass) stay in English regardless of original spelling.`;

  const userPrompt = `Translate the following supplier variant data from Chinese to English.

Product: ${product.title}

${valuesBlock}

Return JSON matching this schema EXACTLY:

{
  "axisNames": ["<English name for Axis 1>", "<English name for Axis 2>", ...],
  "values": {
    "<original axis label as-given>": {
      "<original Chinese value>": "<English value>",
      ...
    },
    ...
  }
}

Rules:
- The "axisNames" array MUST have exactly ${axisCount} entries, in the same order as the axes above.
- The "values" object MUST have a key for EVERY original axis label (use the exact string given above).
- Inside each axis's values object, MUST include EVERY original value verbatim as a key, mapped to its English translation.
- If a value is already English (or numeric / alphanumeric code), copy it unchanged.
- Return ONLY the JSON object. No markdown fences, no commentary.`;

  let resp: TranslationResponse;
  try {
    resp = await claudeJSON({
      model: MODEL,
      system: systemPrompt,
      user: userPrompt,
      maxTokens: 2048,
      temperature: 0.1,
      schema: TranslationResponseSchema,
    });
  } catch (err) {
    console.warn(
      `[variant-translator] translation call failed (${err instanceof Error ? err.message : err}) — returning product unchanged`,
    );
    return product;
  }

  // Apply axis name translations (pad/trim to original length)
  const newOptionNames = product.optionNames.map((n, i) => {
    if (i >= axisCount) return n;
    return resp.axisNames[i] ?? n;
  });

  // Build per-axis value lookup using the ORIGINAL axis labels as keys
  const valueLookups: Array<Map<string, string>> = axisLabels.map((label) => {
    const m = new Map<string, string>();
    const bucket = resp.values[label];
    if (bucket && typeof bucket === "object") {
      for (const [k, v] of Object.entries(bucket)) {
        if (typeof v === "string") m.set(k, v);
      }
    }
    return m;
  });

  // Mutate variants
  for (const v of product.variants) {
    for (let i = 0; i < axisCount; i++) {
      const slot = `option${i + 1}` as "option1" | "option2" | "option3";
      const labelSlot = `supplierLabel${i + 1}` as
        | "supplierLabel1"
        | "supplierLabel2"
        | "supplierLabel3";
      const oldVal = v[slot];
      if (!oldVal) continue;
      const newVal = valueLookups[i].get(oldVal);
      if (newVal && newVal !== oldVal) {
        if (!v[labelSlot]) v[labelSlot] = oldVal;
        v[slot] = newVal;
      } else if (!v[labelSlot] && hasChinese(oldVal)) {
        // Preserve the original even when translation didn't change anything,
        // so we always have an audit trail for originally-Chinese values.
        v[labelSlot] = oldVal;
      }
    }
  }

  product.optionNames = newOptionNames;
  return product;
}
