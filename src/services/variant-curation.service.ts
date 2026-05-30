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
 *   Stage B (one Claude Haiku 4.5 call) — RUTHLESS pruning for a US-only store:
 *     - Send product title + surviving variants
 *     - LLM decides which axes survive, which variants get cut as noise, and
 *       which axes get killed entirely (seller picks a default to fulfill)
 *     - Default is to CUT, not keep. When in doubt, cut.
 *
 * Original supplier values are preserved on `supplierLabel1/2/3` before any
 * rename/restructure overwrites option1/2/3.
 *
 * This service does NOT write to the database — the caller persists. Dropped
 * variants are returned with `isHidden: true` markers; the caller flips that
 * flag on the corresponding DB rows. The `summary` field on the result is a
 * human-readable audit log to surface in JobLog.
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
  /** Human-readable audit of what got cut/killed/collapsed by the LLM, for JobLog. */
  summary?: {
    axesKilled: Array<{ axis: string; defaultPicked?: string; reason?: string }>;
    collapsedWithinAxis: Array<{ axis: string; kept: string; merged: string[]; reason?: string }>;
    noiseCutCount: number;
  };
}

/**
 * Ruthless-curation response. The LLM decides the final axis structure,
 * per-variant option assignments, what to cut as noise, and an audit log of
 * the axes it killed and the values it collapsed.
 */
const RuthlessResponseSchema = z.object({
  /** Final customer-facing axis names, in order. 0-3 entries; 0 means the LLM nuked every axis (single SKU). */
  finalAxes: z.array(z.string()).min(0).max(3),

  /** Per surviving variant: the new option1/2/3 values. sourceIndex = 0-based position in the input list. */
  variantMapping: z
    .array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        option1: z.string().nullable(),
        option2: z.string().nullable(),
        option3: z.string().nullable(),
      }),
    )
    .default([]),

  /** Variants to hide entirely (regional plugs, voltage mismatches, photo-only variants, etc). */
  cutAsNoise: z
    .array(
      z.object({
        sourceIndex: z.number().int().nonnegative(),
        reason: z.string(),
      }),
    )
    .default([]),

  /** Audit: which axes did the LLM kill entirely + what default did it pick. */
  axesKilled: z
    .array(
      z.object({
        axis: z.string(),
        defaultPicked: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),

  /** Audit: which near-duplicate values within a surviving axis got merged. */
  collapsedWithinAxis: z
    .array(
      z.object({
        axis: z.string(),
        kept: z.string(),
        merged: z.array(z.string()),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});

type RuthlessResponse = z.infer<typeof RuthlessResponseSchema>;

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
 * Stage B — ruthless LLM curation. Returns null on any failure (caller treats
 * as "no changes; pass through survivors unchanged").
 */
async function llmRuthlessCuration(args: {
  productTitle: string;
  optionNames: string[];
  variants: ScrapedVariant[];
}): Promise<RuthlessResponse | null> {
  if (!isClaudeConfigured()) {
    return null;
  }

  const systemPrompt = `You are a ruthless product variant editor for a US-market dropshipping store. You receive raw variant lists scraped from 1688/Alibaba listings and return a trimmed list containing only meaningfully distinct, customer-facing variants. Your default is to cut, not keep. When in doubt, cut.

STEP 1 — DECOMPOSE PACKED AXES (do this FIRST, before any cut/keep decision):
A "packed" axis is one whose values cram multiple semantic dimensions into a single string. Examples:
- "USB, Warm Light, On/Off" → packs Power Source + Light Color + Control Method
- "Round 40cm white 48W tri-color" → packs Shape + Size + Light Color + Wattage
- "EU Plug 220V Bluetooth" → packs Region + Voltage + Control Method
- "Round (8")" → packs Shape + Size
- "Black walnut large" → packs Material + Size
Before applying the core test, mentally SPLIT each packed value into its constituent sub-dimensions and treat each sub-dimension as its own axis. Then apply the kill/keep rules to each sub-dimension separately. The output's finalAxes should reflect the cleaned, decomposed structure — NEVER repeat a packed axis verbatim.

SPLIT-BY-DEFAULT RULE (very important):
Shopify allows up to 3 option axes per product. Whenever a surviving packed axis contains 2+ customer-facing sub-dimensions that EACH pass the core test (e.g. Shape + Size, Material + Size, Color + Finish, Pattern + Size), and splitting them keeps the total axis count at ≤ 3, you MUST split them into separate finalAxes. Do NOT leave shape and size fused as "Shape & Size" / "Style & Size" / etc. just because the supplier sent them packed.
- Examples of splits you MUST do (assuming axis budget allows):
  - "Shape & Size" with values like "Round (8")", "Square (9")" → finalAxes ["Shape", "Size"], values ["Round", "Square"] × ["8\"", "9\""]
  - "Material & Size" with values like "Walnut Large", "Oak Small" → finalAxes ["Material", "Size"]
  - "Color & Finish" with values like "Brass Brushed", "Brass Polished" → finalAxes ["Color", "Finish"]
- Only keep a packed-axis name when splitting would push the axis count above 3 AND every sub-dimension passes the core test (rare — usually one sub-dimension can be killed off instead).
- After splitting, emit each surviving variant's option1/2/3 with the clean, separated values — never re-pack them with delimiters like "/", "·", or parentheses.

THE CORE TEST
Keep a variant (sub-)axis only if both are true:
1. The customer can immediately see the difference in a listing photo or product title (color, size, shape, pattern, material, style).
2. The customer would actually care which one they get when it arrives.
If either is false, kill the axis entirely and pick one default for the seller to fulfill.

AXES TO KEEP (customer-facing, customer-chosen):
- Color of the main product (real dye differences, not lighting)
- Size, dimensions, capacity
- Style or silhouette (shape, sleeve length, with-handle vs without)
- Pattern or print (distinct graphics, not photo crops)
- Material when visually obvious (leather vs fabric, wood vs metal)
- Bundles with substantial accessories that change what's in the box (e.g., lamp alone vs lamp + stand + spare bulb)

AXES TO KILL ENTIRELY (seller picks the default, no customer choice shown):
These are not variants. They're internal fulfillment decisions. Remove them from the listing and pick the default:
- Remote vs Bluetooth / app control → kill the axis, default to Bluetooth. Only keep if the listing's title or main photos specifically market one control method as the headline feature.
- Warm / neutral / cool / tri-color light → if tri-color is one of the options, always default to tri-color and remove the axis. If only warm and neutral exist without a tri-color option, keep the axis.
- Pack quantity (1-pack vs 2-pack vs 3-pack of the same item) → default to 1-pack, remove the axis. Exception: if the multi-pack version is physically a different product — e.g., a 2-set of lights that connect or merge into one combined piece, a matching pair designed to function together, a left/right item that only works as a set — then keep the axis, because the customer is choosing between genuinely different products. The test: is the 2-pack just "the same thing × 2 at a discount," or is it "a different product that happens to include two units"? Kill the first, keep the second.
- Plug type → always US plug, remove the axis.
- Packaging (gift box vs no box, with/without bag) → default to the nicer packaging, remove the axis.
- Logo / no logo / brand variants on otherwise generic products → default to no logo, remove the axis.
- Color of secondary components (remote color, controller color, cable color) when the main product color is its own axis → pick any, remove.
- Small cable length differences (e.g., 1 m vs 1.2 m vs 1.5 m) → default to the longest, remove the axis.
- Voltage when only one is US-compatible → pick the compatible one, remove.

This list is illustrative, not exhaustive. Apply the core test to any axis not listed: if the customer can't see it in a photo and won't materially care, kill it.

AXES TO COLLAPSE (keep the axis, merge duplicates within it):
- Lighting variations of the same item: warm vs cool, daylight vs lamp, studio vs lifestyle
- Background, prop, staging, angle, crop differences
- Model vs flat-lay vs mannequin shots of the same SKU
- Near-duplicate color names that are almost certainly the same dye ("off-white," "cream," "milky white," "ivory" → pick one)
- "Aesthetic" or "vibe" variants — moody version, bright version, cozy version

EDGE CASES:
- When two variants might genuinely differ: if I bought both, could I tell them apart with the lights off and the packaging removed? If no, collapse them.
- For colors on the borderline (beige vs khaki, navy vs midnight blue): default to collapsing unless the listing's own swatch chips clearly show two different dyes.
- For sizes: always keep all of them. Never collapse sizes.
- For pack quantity: when in doubt about whether a multi-pack is "merged product" vs "same thing × N," look at the listing photos. If the multi-pack is photographed as a single composed piece (two lamps installed as a pair, a set of nesting tables shown together as one product), it's merged — keep. If the multi-pack is photographed as N identical units lined up, it's a discount bundle — kill.

If the input has fewer than ~5 variants total, return mostly as-is — only cut things that clearly fail the core test.

VALUE FORMATTING (apply when emitting final option values):
- Title Case names ("Linen Gray", "Warm White"). Acronyms stay uppercase (LED, USB-C, IP65). Units stay canonical ("30 cm", "5 W", "2,000 mAh"). Lowercase ", tri-color" suffix is allowed.
- Shape and size are ALWAYS separate axes when both pass the core test (see SPLIT-BY-DEFAULT RULE). Shape values are bare ("Round", "Square", "Rectangle"). Size values carry their units inside the same axis ("40 cm", "50 × 50 cm", "90 × 60 cm"). Always keep cm; a downstream post-processor converts to inches.
- Only fall back to packed "Shape (Size)" format (e.g. "Round (40 cm)") when splitting them would push the axis count above 3 — i.e. only when 3 other axes already survive.

OUTPUT — strict JSON, no commentary, no markdown fences. Return one object with these keys:
{
  "finalAxes": ["<axis name>", ...],                       // 0-3 entries, in display order
  "variantMapping": [                                      // one entry per surviving variant
    { "sourceIndex": <0-based position in the input list>, "option1": "<value>" | null, "option2": "<value>" | null, "option3": "<value>" | null }
  ],
  "cutAsNoise": [
    { "sourceIndex": <int>, "reason": "<one line>" }
  ],
  "axesKilled": [
    { "axis": "<source axis name>", "defaultPicked": "<what the seller should fulfill>", "reason": "<one line>" }
  ],
  "collapsedWithinAxis": [
    { "axis": "<axis name>", "kept": "<canonical value>", "merged": ["<other 1>", "<other 2>"], "reason": "<one line>" }
  ]
}

CRITICAL:
- Every source variant must appear in EXACTLY ONE of: variantMapping (survives) OR cutAsNoise (hidden). No source index in both, none missing.
- The number of non-null values in each variantMapping row must match finalAxes.length — if finalAxes is ["Color"], only option1 should be non-null on each survivor.
- Don't fabricate combos. Each variantMapping row corresponds to one real source variant.
- Killed axes should NOT appear in finalAxes; their info goes only in axesKilled.

WORKED EXAMPLE
Input — 2 source axes "Fabric Color / Power & Control", 18 variants:
  0. Floral | USB, Warm Light, On/Off
  1. Floral | USB, Tri-Color, Multi-Level Dimming
  2. Floral | USB, Tri-Color, Remote + Timer
  3. Floral | 220V Plug, Warm Light, On/Off
  4. Floral | US Plug, Tri-Color, 3-Level Dimming
  5. Floral | EU Plug, Tri-Color, 3-Level Dimming
  6-11. Gold | (same 6 control combos)
  12-17. White | (same 6 control combos)

Decompose "Power & Control" → Plug Type + Light Color + Control Method (3 sub-axes packed into one).
Apply kill rules to each sub-axis:
- Plug Type: kill (always US plug rule). Cut all non-US variants (220V/EU plug) as noise. Default the rest to USB.
- Light Color: tri-color is offered → kill, default tri-color. Cut warm-light-only variants as noise.
- Control Method: kill (customer can't see it / won't care which dimming style). Default to the most premium (Charging + Touch Dimming if present).
Final structure: 1 axis "Color" × 3 values (Floral, Gold, White) = 3 survivors. Rest go to cutAsNoise. Output:
{
  "finalAxes": ["Color"],
  "variantMapping": [
    { "sourceIndex": 1, "option1": "Floral", "option2": null, "option3": null },
    { "sourceIndex": 7, "option1": "Gold", "option2": null, "option3": null },
    { "sourceIndex": 13, "option1": "White", "option2": null, "option3": null }
  ],
  "cutAsNoise": [
    { "sourceIndex": 0, "reason": "warm-light only — tri-color default" },
    { "sourceIndex": 2, "reason": "duplicate of Floral after killing control axis" },
    { "sourceIndex": 3, "reason": "220V plug — US store" },
    { "sourceIndex": 4, "reason": "duplicate of Floral after killing control + plug axes" },
    { "sourceIndex": 5, "reason": "EU plug — US store" }
    // ...same pattern for the rest
  ],
  "axesKilled": [
    { "axis": "Plug Type (within Power & Control)", "defaultPicked": "USB", "reason": "US-only store" },
    { "axis": "Light Color (within Power & Control)", "defaultPicked": "Tri-Color", "reason": "tri-color offered, default to it" },
    { "axis": "Control Method (within Power & Control)", "defaultPicked": "Charging + Touch Dimming", "reason": "customer can't see the difference, won't care" }
  ],
  "collapsedWithinAxis": []
}

This is the kind of aggressive cut we want. Don't shy away from killing entire axes.`;

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

Decide which variants the customer needs to see, kill the axes that aren't customer choices, and emit the JSON.`;

  try {
    // Large variant counts (100+) produce long mapping JSON. Claude Haiku 4.5
    // supports up to 64K output tokens; 16K fits ~400-variant products safely.
    const parsed = await claudeJSON({
      model: MODEL,
      system: systemPrompt,
      user: userContent,
      maxTokens: 16384,
      temperature: 0.2,
      schema: RuthlessResponseSchema,
    });
    return parsed;
  } catch (err) {
    console.warn(
      `[variant-curation] LLM ruthless curation failed: ${err instanceof Error ? err.message : err}`,
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

  // Stage B — ruthless LLM curation
  const resp = await llmRuthlessCuration({
    productTitle,
    optionNames,
    variants: survivors,
  });

  if (!resp) {
    return applyTitleCaseToResult({
      kept: survivors.map((v) => ({ ...v })),
      dropped,
      renamed: [],
      optionNames,
    });
  }

  // Apply LLM decisions to the surviving set. The LLM's sourceIndex is into
  // `survivors`, not the original `variants` array — so we translate back via
  // `survivorIdxs` only when surfacing audit info to the caller.
  const cutSet = new Set(resp.cutAsNoise.map((c) => c.sourceIndex));
  const cutReasons = new Map(resp.cutAsNoise.map((c) => [c.sourceIndex, c.reason]));
  const mappingBySource = new Map<
    number,
    (typeof resp.variantMapping)[number]
  >();
  for (const m of resp.variantMapping) mappingBySource.set(m.sourceIndex, m);

  const kept: CuratedVariant[] = [];
  const renamed: RenameDecision[] = [];

  for (let i = 0; i < survivors.length; i++) {
    const v = survivors[i];

    // Hidden by LLM as noise (regional plug, voltage mismatch, photo-only, etc).
    if (cutSet.has(i)) {
      dropped.push({
        variant: { ...v, isHidden: true },
        reason: `LLM curation — ${cutReasons.get(i) ?? "cut as noise"}`,
      });
      continue;
    }

    const m = mappingBySource.get(i);
    if (!m) {
      // Defensive: LLM didn't decide this one. Keep as-is rather than lose data.
      kept.push({ ...v });
      continue;
    }

    const out: CuratedVariant = { ...v };
    // Preserve original packed values on supplierLabel1/2/3 (audit trail).
    if (v.option1 && !out.supplierLabel1) out.supplierLabel1 = v.option1;
    if (v.option2 && !out.supplierLabel2) out.supplierLabel2 = v.option2;
    if (v.option3 && !out.supplierLabel3) out.supplierLabel3 = v.option3;

    out.option1 = m.option1 ?? undefined;
    out.option2 = m.option2 ?? undefined;
    out.option3 = m.option3 ?? undefined;

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

    kept.push(out);
  }

  // Post-curation dedup: when the LLM kills an axis, multiple survivors may
  // collapse to identical option1/2/3 (e.g. 5 control methods × 1 color
  // → 5 identical rows after killing the control axis). Keep the FIRST,
  // hide the rest so the customer doesn't see clones.
  const seenCombos = new Map<string, number>();
  const dedupedKept: CuratedVariant[] = [];
  for (let idx = 0; idx < kept.length; idx++) {
    const v = kept[idx];
    const comboKey = `${normalize(v.option1)}|${normalize(v.option2)}|${normalize(v.option3)}`;
    if (seenCombos.has(comboKey)) {
      dropped.push({
        variant: { ...v, isHidden: true },
        reason: `post-curation duplicate of variant @ position ${seenCombos.get(comboKey)} (axis kill produced identical SKU)`,
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
    optionNames: resp.finalAxes,
    summary: {
      axesKilled: resp.axesKilled,
      collapsedWithinAxis: resp.collapsedWithinAxis,
      noiseCutCount: resp.cutAsNoise.length,
    },
  });
}
