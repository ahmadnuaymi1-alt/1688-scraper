/**
 * Variant Curation Service.
 *
 * Runs after scrape when `ScrapeOptions.autoCurateVariants` is true. Two stages:
 *
 *   Stage A (deterministic, no LLM):
 *     - Drop pack-size variants
 *     - Drop RGB / multi-color "disco" variants
 *     - Drop exact duplicates
 *
 *   Stage B (one Claude Haiku 4.5 call):
 *     - Send product title + surviving variants + the variant-curation
 *       renaming heuristics
 *     - Receive structured JSON: { axisRenames, valueRenames }
 *     - Apply renames to each surviving variant's option1/2/3 + optionNames
 *
 * Original supplier values are preserved on `supplierLabel1/2/3` before any
 * rename overwrites option1/2/3.
 *
 * This service does NOT write to the database — the caller persists. Dropped
 * variants are returned with `isHidden: true` markers; the caller flips that
 * flag on the corresponding DB rows.
 */

import { z } from "zod";
import { claudeJSON, isClaudeConfigured } from "@/lib/ai/claude-client";
import { reshapeVariantSizeToInches } from "@/lib/units";
import type { ScrapedVariant } from "@/types/product";

const MODEL = "claude-haiku-4-5";

export interface CuratedVariant extends ScrapedVariant {
  /** Soft-delete marker for the caller to persist. */
  isHidden?: boolean;
}

export interface DropDecision {
  variant: CuratedVariant;
  reason: string;
}

export interface RenameDecision {
  variant: CuratedVariant;
  changedAxes: Array<{
    axisIndex: 1 | 2 | 3;
    from: string;
    to: string;
  }>;
}

export interface CurationResult {
  /** All variants the user should see post-curation, with renamed option1/2/3 + populated supplierLabel*. */
  kept: CuratedVariant[];
  /** Variants flagged for soft-delete (isHidden=true), with a reason. */
  dropped: DropDecision[];
  /** Per-variant rename audit log for Stage B. */
  renamed: RenameDecision[];
  /** New customer-friendly axis names (may equal the input if Stage B didn't run). */
  optionNames: string[];
}

const RenameResponseSchema = z.object({
  // Path A — keep the source axis structure, only rename labels + values.
  // Used when 1688 already gives 3 distinct axes (no room to split further)
  // or when no source axis is "packed".
  axisRenames: z.record(z.string(), z.string()).default({}),
  valueRenames: z
    .array(
      z.object({
        axisIndex: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        from: z.string(),
        to: z.string(),
      }),
    )
    .default([]),

  // Path B — RESTRUCTURE the axes. Used when 1688 only fills 1-2 axes AND
  // one is "packed" (e.g. a single Light Color value contains size + control
  // + color mashed together). When present, this supersedes axisRenames /
  // valueRenames — the caller rebuilds each survivor from variantMapping.
  restructure: z
    .object({
      newOptionNames: z.array(z.string()).min(1).max(3),
      variantMapping: z.array(
        z.object({
          sourceIndex: z.number().int().nonnegative(),
          option1: z.string().nullable(),
          option2: z.string().nullable(),
          option3: z.string().nullable(),
        }),
      ),
    })
    .optional(),
});

type RenameResponse = z.infer<typeof RenameResponseSchema>;

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Stage A — deterministic drops. Returns dropDecisions in original variant
 * order; does not mutate the input array.
 */
function applyDeterministicRules(variants: ScrapedVariant[]): Map<number, string> {
  const drops = new Map<number, string>();

  const PACK_PATTERN =
    /(\d+\s*[-]?\s*pack|single\s+pack|box\s+of|multi[-\s]?pack|wholesale\s+box|bundle\s+of|bulk\s+of)/i;
  const RGB_PATTERN =
    /\b(rgb|rgbw|multi[-\s]?color|color[-\s]?changing|color[-\s]?lock|seven[-\s]?color|7[-\s]?color|disco)\b/i;

  // Pass 1: pack-size
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const allOpts = `${v.option1 ?? ""} ${v.option2 ?? ""} ${v.option3 ?? ""}`;
    if (PACK_PATTERN.test(allOpts)) {
      drops.set(i, "rule 2 — pack-size axis (drop, use cart bundle discount)");
    }
  }

  // Pass 2: RGB / color-changing
  for (let i = 0; i < variants.length; i++) {
    if (drops.has(i)) continue;
    const v = variants[i];
    const allOpts = `${v.option1 ?? ""} ${v.option2 ?? ""} ${v.option3 ?? ""}`;
    if (RGB_PATTERN.test(allOpts)) {
      drops.set(i, "rule 3 — RGB / color-changing (drop for luxury)");
    }
  }

  // Pass 3: exact duplicates
  const seen = new Map<string, number>();
  for (let i = 0; i < variants.length; i++) {
    if (drops.has(i)) continue;
    const v = variants[i];
    const key = `${normalize(v.option1)}|${normalize(v.option2)}|${normalize(v.option3)}|${v.price}`;
    if (seen.has(key)) {
      drops.set(
        i,
        `rule 1 — exact duplicate of variant @ position ${seen.get(key)} (same option values + price)`,
      );
    } else {
      seen.set(key, i);
    }
  }

  return drops;
}

/**
 * Stage B — Claude rename pass. Returns null on any failure (caller treats as
 * "no renames").
 */
async function llmRenamePass(args: {
  productTitle: string;
  optionNames: string[];
  variants: ScrapedVariant[];
}): Promise<RenameResponse | null> {
  if (!isClaudeConfigured()) {
    return null;
  }

  const systemPrompt = `You are a luxury Shopify catalog editor. You rewrite wholesale supplier variant option axes + values into customer-friendly English. Shopify caps each product at 3 axes total.

You have TWO output paths. Pick exactly one based on the source structure.

═══════════════════════════════════════════
PATH A — RENAME ONLY (no axis restructure)
═══════════════════════════════════════════
Use this path when:
- The source already has 3 distinct axes (no room to split), OR
- Source has 1-2 axes and NONE of them are "packed" (each value cleanly represents one dimension).

Rules:
1. Drop supplier internal codes (A1, B2, etc.) when a descriptive replacement is obvious. If you can only guess, fall back to "Style 1, Style 2, …".
2. Strip Chinglish noise — "Telescopic款" → "Adjustable Height", "Cross-border" → drop, "High-end" / "Premium" as a variant value → drop.
3. Axis names: plain English nouns in Title Case (capitalize every word). "battery capacity" → "Battery Capacity". "Specification" / "Model" / "规格" → "Style" / "Design".
4. Values: short, **Title Case** — capitalize every word. "warm white" → "Warm White". "motion sensor" → "Motion Sensor". "tri-color" → "tri-color" (keep lowercase). BUT keep technical units in canonical case: cm / mm / W / V / mAh / kWh stay lowercase or mixed (e.g. "30 cm", "Standard (2,000 mAh)"). Keep acronyms uppercase: LED, USB-C, RGB, IP65. "30cm" → "30 cm". "2000mAh warm" → "Standard (2,000 mAh) Warm".
5. **Shape + size format**: when a value contains a shape word (Round / Square / Rectangle / Oval / Circle) AND a physical size, emit as "Shape (Size cm)" — shape outside parens, dimensions inside parens. Multi-dim sizes stay inside the same parens. Examples: "round 40cm" → "Round (40 cm)", "square 50 × 50 cm" → "Square (50 × 50 cm)", "rectangle 90×60 cm" → "Rectangle (90 × 60 cm)". Always keep cm in the LLM output — a downstream post-processor converts cm → inches deterministically. Do NOT round or convert numbers yourself.
6. **Tri-color is allowed**, do NOT drop or rebrand it. When the supplier includes a tri-color / three-color / CCT-selector / 3-in-1 light-temp option, preserve it in the value as a lowercase ", tri-color" suffix. Examples: "round 40cm three color 2×24W" → "Round (40 cm), tri-color 2×24W". "square 50×50 cm tri-color 2×48W" → "Square (50 × 50 cm), tri-color 2×48W".
7. Don't translate brand-name materials — Linen / Brass / Walnut stay as-is.

Output:
{
  "axisRenames": { "<supplier axis name>": "<customer axis name>" },
  "valueRenames": [ { "axisIndex": 1|2|3, "from": "<supplier value>", "to": "<customer value>" } ]
}
- Include EVERY supplier axis in axisRenames (even if unchanged: { "Color": "Color" }).
- Include EVERY unique value across the variants in valueRenames.

═══════════════════════════════════════════
PATH B — RESTRUCTURE (split a packed axis)
═══════════════════════════════════════════
Use this path when the source has 1-2 axes AND at least one axis's values are "PACKED" — i.e. a single value crams multiple semantic dimensions (e.g. "10 cm, motion sensor + always on + dimming, white light" jams Size + Control + Color into one value).

What to do:
- Identify the packed dimensions (Size, Color/Finish, Functional spec, etc).
- Output up to 3 NEW axes, prioritizing the dimensions a US customer would shop on:
  • Size / dimension first — and if a shape word is present, use "Shape (Size cm)" format: "Round (10 cm)", "Round (20 cm)", "Square (50 × 50 cm)", "Rectangle (90 × 60 cm)". Otherwise plain "10 cm".
  • Color / finish second (white, warm, tri-color / Brass / Walnut)
  • Functional spec third (motion sensor, button control, USB-C, dimming, etc.)
- For each surviving variant (by its sourceIndex = position in the input list), emit the new option1/2/3 values you've assigned.
- If a particular variant doesn't have a value for one of the new axes, set it to null.
- DON'T fabricate new combos — only output one row per source variant. (The system will auto-hide unavailable Cartesian combos separately.)

Output:
{
  "axisRenames": {},
  "valueRenames": [],
  "restructure": {
    "newOptionNames": ["Size", "Light Color", "Control"],
    "variantMapping": [
      { "sourceIndex": 0, "option1": "Round (10 cm)", "option2": "White light", "option3": "Motion sensor" },
      { "sourceIndex": 1, "option1": "Round (20 cm)", "option2": "White light", "option3": "Motion sensor" }
    ]
  }
}

═══════════════════════════════════════════
LUXURY DESIGN RENAMING (applies to BOTH paths)
═══════════════════════════════════════════
A "design / style / model" axis holds aspirational labels — they don't describe a measurable spec, they're marketing. If a value reads generic — "Standard", "Plastic Stand", "Plastic Frame Lamp", "Stand Model B", "Model A/B/C", "Type 1/2/3", "Frame Lamp", "Bracket Lamp", "Basic", "Regular", "Premium" used as a sole descriptor — REPLACE it with an aspirational, luxury-coded name that fits the product's actual silhouette (UFO-shaped → "Halo", linear pillar → "Spire", brass cylinder → "Atelier", etc.). One-to-three words, evocative, not literal. Examples:

  "Plastic Stand"       → "Cosmo Spire"
  "Stand Model B"       → "Halo Lantern"
  "Frame Lamp"          → "Capsule Beacon"
  "Standard"            → "Atelier"
  "Type A UFO"          → "Halo" (drop the placeholder "Type A")
  "Model C"             → "Lumen Crown"

Do NOT rebrand:
  - Functional values: sizes (10cm / 20cm), wattages (5W / 7W), color temperatures (Warm white / Cool white), voltages, battery capacities (1,200 mAh / 2,000 mAh).
  - Branded materials: Linen, Brass, Walnut, Marble, Oak, Onyx, Travertine — pass through unchanged.
  - Color names: Black, Silver, Gold, Pink, Blue, Cream, etc. — pass through unchanged.

Use this rule freely in BOTH path A (rename-only) and path B (restructure) — for any axis whose values look like generic design placeholders.

═══════════════════════════════════════════
RULES FOR BOTH PATHS
═══════════════════════════════════════════
- Return ONLY the JSON object. No commentary, no markdown fences.
- Use ONE path. If you pick Path A, omit "restructure". If you pick Path B, output empty axisRenames + valueRenames AND a "restructure" block.`;

  const sourceAxisCount = args.optionNames.filter((n) => n && n.trim().length > 0).length;
  const userContent = `Product: ${args.productTitle}

Source has ${sourceAxisCount} axis/axes (supplier order): ${args.optionNames.join(" / ")}

Variants (sourceIndex = the 0-based position in this list):
${args.variants
  .map((v, i) => {
    const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
    return `${i}. ${opts}`;
  })
  .join("\n")}

Decide: PATH A (just rename) or PATH B (restructure to split packed axes)?
- If the source already has 3 axes and none are packed → PATH A.
- If the source has 1-2 axes AND any value packs multiple semantic dimensions (size + control + color mashed together) → PATH B; restructure to up to 3 clean axes.

Output the JSON.`;

  try {
    // Large variant counts (100+) produce long mapping JSON. Claude Haiku 4.5
    // supports up to 64K output tokens; 16K fits ~400-variant products safely.
    const parsed = await claudeJSON({
      model: MODEL,
      system: systemPrompt,
      user: userContent,
      maxTokens: 16384,
      temperature: 0.2,
      schema: RenameResponseSchema,
    });
    return parsed;
  } catch (err) {
    console.warn(
      `[variant-curation] LLM rename pass failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * Canonical case for the technical units we expect to see embedded in
 * variant values. The Title Case post-processor looks each token up here
 * (case-insensitive) before falling back to plain title-casing — so "cm"
 * stays "cm", "mAh" stays "mAh", instead of being mangled to "Cm" / "Mah".
 */
const CANONICAL_UNITS: Record<string, string> = {
  cm: "cm", mm: "mm", m: "m", km: "km", in: "in", ft: "ft",
  oz: "oz", lb: "lb", kg: "kg", g: "g",
  ml: "mL", l: "L", dl: "dL",
  w: "W", kw: "kW", kwh: "kWh", v: "V", a: "A", ma: "mA", mah: "mAh", ah: "Ah",
  s: "s", ms: "ms", min: "min", hr: "hr", k: "K",
};

/**
 * Title-case every alphabetic token in the input, with three preservation
 * rules:
 *   1. All-caps acronyms (length ≥ 2) pass through — LED, USB, RGB, IP65.
 *   2. Tokens with internal capitals pass through — mAh, kWh, iPhone.
 *   3. Tokens matching a known unit get their canonical case from
 *      CANONICAL_UNITS — "cm" stays "cm", "mah" becomes "mAh".
 * Everything else gets the first letter capitalized, rest lowercased.
 *
 * Punctuation and numbers are untouched, so "2,000 mAh" → "2,000 mAh" and
 * "USB-C" → "USB-C" (the regex matches alpha runs, leaving the hyphen).
 */
function toTitleCasePreservingUnits(input: string | null | undefined): string {
  if (!input) return input ?? "";
  return input.replace(/[a-zA-Z][a-zA-Z0-9]*/g, (token) => {
    if (/^[A-Z][A-Z0-9]+$/.test(token)) return token;
    if (/[a-z][A-Z]/.test(token)) return token;
    const canonical = CANONICAL_UNITS[token.toLowerCase()];
    if (canonical) return canonical;
    return token[0].toUpperCase() + token.slice(1).toLowerCase();
  });
}

/**
 * Apply Title Case + cm→in conversion in-place to a CurationResult.
 * Title casing fixes English/units; reshape converts any cm inside parens
 * (and unwrapped "Shape N cm" patterns) into inches, e.g. "Round (40 cm)"
 * → `Round (16")`. supplierLabel1/2/3 are deliberately NOT touched.
 */
function applyTitleCaseToResult(result: CurationResult): CurationResult {
  const titleAndReshape = (s: string | undefined): string | undefined => {
    if (!s) return s;
    return reshapeVariantSizeToInches(toTitleCasePreservingUnits(s));
  };
  return {
    ...result,
    optionNames: result.optionNames.map((n) => toTitleCasePreservingUnits(n)),
    kept: result.kept.map((v) => ({
      ...v,
      option1: titleAndReshape(v.option1),
      option2: titleAndReshape(v.option2),
      option3: titleAndReshape(v.option3),
    })),
  };
}

/**
 * Public entry point.
 *
 * Applies Stage A (deterministic) + Stage B (LLM rename) to a `ScrapedVariant[]`
 * and returns the curated result. Does NOT write to the database — caller
 * persists `isHidden` + renamed option1/2/3 + supplierLabel1/2/3 themselves.
 *
 * `optionNames` defaults to inferred axis names (Option 1 / 2 / 3) if not
 * provided; pass the actual scraped names for best rename quality.
 */
export async function autoCurateVariants(
  variants: ScrapedVariant[],
  productTitle: string,
  optionNames: string[] = [],
): Promise<CurationResult> {
  if (variants.length <= 1) {
    return applyTitleCaseToResult({ kept: variants, dropped: [], renamed: [], optionNames });
  }

  // Stage A
  const dropMap = applyDeterministicRules(variants);
  const dropped: DropDecision[] = [];
  const survivorIdxs: number[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (dropMap.has(i)) {
      dropped.push({
        variant: { ...variants[i], isHidden: true },
        reason: dropMap.get(i)!,
      });
    } else {
      survivorIdxs.push(i);
    }
  }

  const survivors = survivorIdxs.map((i) => variants[i]);
  if (survivors.length === 0) {
    return applyTitleCaseToResult({ kept: [], dropped, renamed: [], optionNames });
  }

  // Stage B
  const renameResp = await llmRenamePass({
    productTitle,
    optionNames,
    variants: survivors,
  });

  if (!renameResp) {
    return applyTitleCaseToResult({
      kept: survivors.map((v) => ({ ...v })),
      dropped,
      renamed: [],
      optionNames,
    });
  }

  // PATH B — restructure: rebuild each survivor from the per-variant mapping.
  // Preserves the original option1/2/3 verbatim onto supplierLabel1/2/3 so we
  // keep an audit trail of what 1688 originally sent.
  if (renameResp.restructure && renameResp.restructure.variantMapping.length > 0) {
    const mappingBySource = new Map<number, (typeof renameResp.restructure.variantMapping)[number]>();
    for (const m of renameResp.restructure.variantMapping) {
      mappingBySource.set(m.sourceIndex, m);
    }

    const kept: CuratedVariant[] = [];
    const renamed: RenameDecision[] = [];
    for (let i = 0; i < survivors.length; i++) {
      const v = survivors[i];
      const m = mappingBySource.get(i);
      if (!m) {
        // No mapping for this variant — keep as-is (defensive).
        kept.push({ ...v });
        continue;
      }
      const out: CuratedVariant = { ...v };
      // Preserve original packed values on supplierLabel1/2/3 (audit trail).
      if (v.option1 && !out.supplierLabel1) out.supplierLabel1 = v.option1;
      if (v.option2 && !out.supplierLabel2) out.supplierLabel2 = v.option2;
      if (v.option3 && !out.supplierLabel3) out.supplierLabel3 = v.option3;
      // Apply restructured values (null in the schema → undefined on the type).
      out.option1 = m.option1 ?? undefined;
      out.option2 = m.option2 ?? undefined;
      out.option3 = m.option3 ?? undefined;
      kept.push(out);

      const changedAxes: RenameDecision["changedAxes"] = [];
      if (v.option1 && m.option1 && m.option1 !== v.option1) {
        changedAxes.push({ axisIndex: 1, from: v.option1, to: m.option1 });
      }
      if (v.option2 && m.option2 && m.option2 !== v.option2) {
        changedAxes.push({ axisIndex: 2, from: v.option2, to: m.option2 });
      }
      if (v.option3 && m.option3 && m.option3 !== v.option3) {
        changedAxes.push({ axisIndex: 3, from: v.option3, to: m.option3 });
      }
      if (changedAxes.length > 0) renamed.push({ variant: out, changedAxes });
    }

    // Post-restructure dedup: after the split, multiple source variants may
    // collapse to identical option1/2/3 (e.g. 6 packaging options × 1 model
    // → 6 identical rows after dropping packaging). Keep the FIRST occurrence
    // of each combo; mark subsequent duplicates as hidden so the customer
    // doesn't see 6 copies of the same SKU.
    const seenCombos = new Map<string, number>();
    const dedupedKept: CuratedVariant[] = [];
    for (let idx = 0; idx < kept.length; idx++) {
      const v = kept[idx];
      const comboKey = `${normalize(v.option1)}|${normalize(v.option2)}|${normalize(v.option3)}`;
      if (seenCombos.has(comboKey)) {
        dropped.push({
          variant: { ...v, isHidden: true },
          reason: `post-restructure duplicate of variant @ position ${seenCombos.get(comboKey)} (same option values after split)`,
        });
      } else {
        seenCombos.set(comboKey, idx);
        dedupedKept.push(v);
      }
    }

    return applyTitleCaseToResult({
      kept: dedupedKept,
      dropped,
      renamed,
      optionNames: renameResp.restructure.newOptionNames,
    });
  }

  // PATH A — keep source axes, only rename labels + values.
  const renameLookup = new Map<string, string>();
  for (const r of renameResp.valueRenames) {
    renameLookup.set(`${r.axisIndex}|${normalize(r.from)}`, r.to);
  }

  const kept: CuratedVariant[] = [];
  const renamed: RenameDecision[] = [];
  for (const v of survivors) {
    const out: CuratedVariant = { ...v };
    const changedAxes: RenameDecision["changedAxes"] = [];
    for (const axisIndex of [1, 2, 3] as const) {
      const key = `option${axisIndex}` as "option1" | "option2" | "option3";
      const labelKey = `supplierLabel${axisIndex}` as
        | "supplierLabel1"
        | "supplierLabel2"
        | "supplierLabel3";
      const oldVal = v[key];
      if (!oldVal) continue;
      const newVal = renameLookup.get(`${axisIndex}|${normalize(oldVal)}`);
      if (newVal && newVal !== oldVal) {
        out[key] = newVal;
        // Preserve original on supplierLabel* if not already set
        if (!out[labelKey]) out[labelKey] = oldVal;
        changedAxes.push({ axisIndex, from: oldVal, to: newVal });
      }
    }
    kept.push(out);
    if (changedAxes.length > 0) renamed.push({ variant: out, changedAxes });
  }

  // Apply axis renames to optionNames
  const newOptionNames = optionNames.map((n) => renameResp.axisRenames[n] ?? n);

  return applyTitleCaseToResult({
    kept,
    dropped,
    renamed,
    optionNames: newOptionNames,
  });
}
