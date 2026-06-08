/**
 * Variant name-clarity cleanup — runs on EVERY scrape (Phase 2).
 *
 * A polish pass over variant OPTION VALUES (not the axis structure, not the
 * variant set): rewrites wordy / cluttered / supplier-scaffolded values into
 * short, clear, customer-friendly labels following the house style
 * (`~/.claude/skills/variant-curation` → "Exterior with Lining", clarity over
 * extreme brevity, Title Case, drop universal filler).
 *
 * This is DELIBERATELY NOT curation:
 *   - never drops / hides / merges / splits variants or axes
 *   - returns exactly one rewrite per input variant, same axis count
 *   - do-no-harm: if the rewrite would collapse two distinct variants into the
 *     same label (lost information), the whole rewrite is discarded
 *   - opaque codes ("Design A", waffle SKUs) are left to the audit's vision
 *     renamer (check 1) — this step only declutters descriptive text
 *
 * Original supplier values are preserved on supplierLabel1/2/3 (revert trail).
 */

import { z } from "zod";
import { claudeJSON, isClaudeConfigured } from "@/lib/ai/claude-client";
import { toTitleCasePreservingUnits } from "@/services/variant-curation.service";
import { prisma } from "@/lib/db";

const MODEL = "claude-haiku-4-5";

const FILLER_RE =
  /\b(deluxe|premium|high[-\s]?end|luxury|new|upgraded|fashion|hot[-\s]?sale|hot[-\s]?selling|cross[-\s]?border|classic|original|quality|best)\b/i;

const ResponseSchema = z.object({
  renames: z
    .array(
      z.object({
        position: z.number().int(),
        option1: z.string().nullable(),
        option2: z.string().nullable(),
        option3: z.string().nullable(),
      }),
    )
    .default([]),
});

export interface NameCleanupChange {
  variantId: string;
  position: number;
  from: { option1: string | null; option2: string | null; option3: string | null };
  to: { option1: string | null; option2: string | null; option3: string | null };
  /** Existing supplierLabel1/2/3 — used to stamp the original ONLY if empty. */
  existingSupplier: { s1: string | null; s2: string | null; s3: string | null };
}
export interface NameCleanupResult {
  changes: NameCleanupChange[];
  skippedReason?: string;
}

const SYSTEM_PROMPT = `You are a product-catalog editor. You receive the variant option values of ONE already-scraped product (the axes are FIXED) and rewrite each value to be SHORT, CLEAR and customer-friendly. This is a polish pass on the VALUES — NOT curation.

HARD CONSTRAINTS:
- Return EXACTLY one entry per input variant, keyed by its position. Never drop, merge, split, or add variants.
- Keep the SAME axes. Reword ONLY the text WITHIN each existing axis value. Do NOT move content between axes and do NOT add an axis: if a variant's option3 is null in the input, your option3 MUST be null; if option1 is "Gray 9-Compartment" you may clean it to "Gray, 9-Compartment" but you may NOT relocate "9-Compartment" into option2/option3.
- NEVER invent attributes. Only reword what is already in the text. If you can't see an attribute in the value, don't add it.
- PRESERVE every distinguishing detail: colors, sizes (with units), materials, finishes, real features. Two variants that differ in the input MUST still differ in the output.

REWRITE RULES:
1. Drop filler/marketing words that appear on EVERY variant of an axis: "Deluxe", "Premium", "Luxury", "New", "Upgraded", "Fashion", "Hot Sale", "Cross-Border", "Classic", "Original", "Quality", "Best", and redundant supplier scaffolding ("full lock" / "solid wood" / "vintage" when it's on all of them). CHECK FIRST that the word is truly on every variant — if some say "Deluxe" and others "Solid Wood", that word is DISTINGUISHING; keep it.
2. Clarity over extreme brevity. Keep the small connective words ("with") and the anchor noun ("Lining", "Finish", "Interior", "Shade") that make a value self-explanatory. Prefer "Exterior with Lining" phrasing: "Antique with Black Lining", "Black Lining with Mirror". Bare comma fragments like "Black Lining, Mirror" are too cryptic — use "with".
3. Disambiguate the same word by context: on a box where every variant is full-lock, "hooks" is an interior feature → "Necklace Hooks"; when the choice is between closures, "hooks" is the closure → "Hook Closure".
4. Mark a shared/secondary attribute ONLY on the variant(s) where leaving it off would make two variants look identical (e.g. four "Full Lock" + one "Hook Closure" → label only the odd one; let Full Lock be the unstated default).
5. Title Case every word. Units stay canonical (cm, mm, W, mAh, K), acronyms uppercase (LED, USB, IP65, E27).
6. Aim for 1-4 words per value. If a value is already short and clear, return it unchanged.
7. Leave opaque codes alone (e.g. "Design A", "WYBD0013", bare "A1") — return them unchanged; a separate step handles those.

OUTPUT — strict JSON, no markdown:
{ "renames": [ { "position": <int>, "option1": "<value>"|null, "option2": "<value>"|null, "option3": "<value>"|null } ] }`;

/** Cheap gate: is anything here actually wordy / filler-laden enough to bother?
 *  Counts alphabetic words ≥3 chars so dimension/spec values ("20 × 15 × 5 cm",
 *  "12\" × 8\"") don't false-trigger. */
function needsCleanup(
  variants: Array<{ option1: string | null; option2: string | null; option3: string | null }>,
): boolean {
  for (const v of variants) {
    for (const val of [v.option1, v.option2, v.option3]) {
      if (!val) continue;
      if (FILLER_RE.test(val)) return true;
      const alphaWords = (val.match(/[A-Za-z]{3,}/g) ?? []).length;
      if (alphaWords > 3) return true;
    }
  }
  return false;
}

/** Set of axis indices (1/2/3) populated by ANY variant in the set. */
function populatedAxes(
  variants: Array<{ option1: string | null; option2: string | null; option3: string | null }>,
): string {
  const has = [false, false, false];
  for (const v of variants) {
    if (v.option1 && v.option1.trim()) has[0] = true;
    if (v.option2 && v.option2.trim()) has[1] = true;
    if (v.option3 && v.option3.trim()) has[2] = true;
  }
  return has.map((h, i) => (h ? i + 1 : "")).filter(Boolean).join(",");
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const combo = (v: { option1: string | null; option2: string | null; option3: string | null }) =>
  `${norm(v.option1)}|${norm(v.option2)}|${norm(v.option3)}`;

/**
 * Compute (read-only) the proposed clarity renames for a product. No writes.
 */
export async function computeNameCleanup(productId: string): Promise<NameCleanupResult> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      title: true,
      optionNames: true,
      variants: {
        where: { isHidden: false },
        orderBy: { position: "asc" },
        select: {
          id: true, position: true, option1: true, option2: true, option3: true,
          supplierLabel1: true, supplierLabel2: true, supplierLabel3: true,
        },
      },
    },
  });
  if (!product) return { changes: [], skippedReason: "product not found" };
  const variants = product.variants;
  if (variants.length <= 1) return { changes: [], skippedReason: "single variant" };
  if (!needsCleanup(variants)) return { changes: [], skippedReason: "already clean" };
  if (!isClaudeConfigured()) return { changes: [], skippedReason: "claude not configured" };

  let axisNames: string[] = [];
  try {
    const parsed = JSON.parse(product.optionNames ?? "[]");
    if (Array.isArray(parsed)) axisNames = parsed.filter((s): s is string => typeof s === "string");
  } catch { /* ignore */ }

  const userContent = `Product: ${product.title.slice(0, 120)}
Axes: ${axisNames.join(" / ") || "(unnamed)"}

Variants (rewrite the values; keep one entry per position):
${variants
  .map((v) => `${v.position}. ${[v.option1, v.option2, v.option3].filter(Boolean).join(" | ")}`)
  .join("\n")}`;

  let resp: z.infer<typeof ResponseSchema>;
  try {
    resp = await claudeJSON({
      model: MODEL,
      system: SYSTEM_PROMPT,
      user: userContent,
      maxTokens: 4096,
      temperature: 0.1,
      schema: ResponseSchema,
    });
  } catch (err) {
    return { changes: [], skippedReason: `llm failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const byPos = new Map(resp.renames.map((r) => [r.position, r]));
  const tc = (s: string | null) => {
    const out = toTitleCasePreservingUnits(s ?? "").trim();
    return out === "" ? null : out;
  };

  // Build the proposed final set (Title-Cased), keeping the original where the
  // LLM didn't return an entry.
  const proposed = variants.map((v) => {
    const r = byPos.get(v.position);
    if (!r) return { v, o1: v.option1, o2: v.option2, o3: v.option3 };
    return { v, o1: tc(r.option1), o2: tc(r.option2), o3: tc(r.option3) };
  });

  // do-no-harm guard 1: the rewrite must not change the axis STRUCTURE (move
  // content between axes / add / remove an axis). This is a reword pass, not
  // curation — if the LLM restructured, discard it wholesale.
  const proposedVariants = proposed.map((p) => ({ option1: p.o1, option2: p.o2, option3: p.o3 }));
  if (populatedAxes(variants) !== populatedAxes(proposedVariants)) {
    return { changes: [], skippedReason: "rewrite changed axis structure — discarded" };
  }

  // do-no-harm guard 2: the rewrite must not collapse two distinct variants into
  // one label (that would lose a real distinction). If the proposed set has
  // fewer distinct combos than the input did, discard the entire rewrite.
  const inputDistinct = new Set(variants.map(combo)).size;
  const proposedDistinct = new Set(proposed.map((p) => combo({ option1: p.o1, option2: p.o2, option3: p.o3 }))).size;
  if (proposedDistinct < inputDistinct) {
    return { changes: [], skippedReason: "rewrite would collapse distinct variants — discarded" };
  }

  const changes: NameCleanupChange[] = [];
  for (const p of proposed) {
    const changed =
      (p.o1 ?? null) !== (p.v.option1 ?? null) ||
      (p.o2 ?? null) !== (p.v.option2 ?? null) ||
      (p.o3 ?? null) !== (p.v.option3 ?? null);
    if (!changed) continue;
    changes.push({
      variantId: p.v.id,
      position: p.v.position,
      from: { option1: p.v.option1, option2: p.v.option2, option3: p.v.option3 },
      to: { option1: p.o1, option2: p.o2, option3: p.o3 },
      existingSupplier: { s1: p.v.supplierLabel1, s2: p.v.supplierLabel2, s3: p.v.supplierLabel3 },
    });
  }
  return { changes };
}

/**
 * Apply the clarity cleanup. With `apply: false` (default) returns the plan
 * without writing. Preserves original values on supplierLabel1/2/3.
 */
export async function cleanupVariantNames(
  productId: string,
  opts?: { apply?: boolean },
): Promise<NameCleanupResult> {
  const result = await computeNameCleanup(productId);
  if (opts?.apply && result.changes.length > 0) {
    await prisma.$transaction(
      result.changes.map((c) => {
        // Stamp the supplier original ONLY where no supplierLabel exists yet, so
        // we never clobber a true original captured by an earlier step.
        const data: Record<string, string | null> = {
          option1: c.to.option1,
          option2: c.to.option2,
          option3: c.to.option3,
          title: [c.to.option1, c.to.option2, c.to.option3].filter((s): s is string => !!s).join(" / "),
        };
        if (!c.existingSupplier.s1 && c.from.option1) data.supplierLabel1 = c.from.option1;
        if (!c.existingSupplier.s2 && c.from.option2) data.supplierLabel2 = c.from.option2;
        if (!c.existingSupplier.s3 && c.from.option3) data.supplierLabel3 = c.from.option3;
        return prisma.variant.update({ where: { id: c.variantId }, data });
      }),
    );
  }
  return result;
}
