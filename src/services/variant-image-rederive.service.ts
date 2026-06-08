/**
 * Size-aware re-derivation of `Variant.featuredImageId`.
 *
 * Why this exists: 1688 swatch images are linked to ONE owning variant at scrape
 * time (`ProductImage.variantId` — ground truth). The downstream fan-out
 * (`fillSwatchesByOption1`) and the manual autofill only key off the *finish*
 * axis (option1), so when a product has per-SIZE images, every size of a colour
 * collapses onto the first/default swatch of that colour. Phase-2 curation then
 * rewrites the option axes, and the featured image is never re-derived against
 * the final axes — so the wrong-size assignment sticks.
 *
 * This recomputes each variant's featured image by matching it to a source-linked
 * swatch whose owner agrees on BOTH finish and size. It is deliberately
 * **do-no-harm**:
 *   - it only proposes a change when the new candidate is a STRICTLY better
 *     (finish + size) match than the variant's current image;
 *   - it never nulls an existing image;
 *   - it never touches a variant whose current image is a generated hero
 *     (imageType "hero"/"hero-flat") — those have been through hero-gen;
 *   - if finish/size can't be determined for a product it changes nothing.
 *
 * Dictionary-free: the "finish key" is option1 with size tokens stripped, so it
 * works regardless of the actual colour vocabulary. If option1 isn't the finish
 * axis, the finish key comes out empty and nothing matches → no change.
 */

import { prisma } from "@/lib/db";

const SIZE_TOLERANCE_CM = 5;

/** option1 with any size/measurement tokens removed → the finish identity. */
export function finishKeyOf(option1: string | null): string {
  if (!option1) return "";
  return option1
    .replace(/\b\d+(?:\.\d+)?\s*(cm|mm|m|inch|inches|in|")\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Best-effort size in cm from a variant's option values. Prefers an explicit
 * "NN cm"; falls back to the height in a dimension string ("… × 31.5"H × …" →
 * 31.5in → 80cm). Returns null when nothing size-like is present.
 */
export function sizeCmOf(options: Array<string | null>): number | null {
  for (const o of options) {
    if (!o) continue;
    const cm = o.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
    if (cm) return Math.round(parseFloat(cm[1]));
  }
  for (const o of options) {
    if (!o) continue;
    // height component of a W × H × D dimension string
    const h = o.match(/(\d+(?:\.\d+)?)\s*"?\s*H\b/i);
    if (h) return Math.round(parseFloat(h[1]) * 2.54);
  }
  return null;
}

interface VariantLite {
  id: string;
  title: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  isHidden: boolean;
  featuredImageId: string | null;
}
interface ImageLite {
  id: string;
  variantId: string | null;
  storagePath: string | null;
  sourceUrl: string;
  fileName: string | null;
  imageType: string | null;
  position: number;
}

/** Same sanitisation the hero script uses to derive a hero's groupKey/fileName
 *  from its source image's storagePath. Lets us map a hero back to its source. */
function heroGroupKeyOf(sourceKey: string): string {
  return sourceKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function optsOf(v: VariantLite): Array<string | null> {
  return [v.option1, v.option2, v.option3];
}
function labelOf(v: VariantLite): string {
  const parts = optsOf(v).filter((s): s is string => !!s && s.trim() !== "");
  return parts.length ? parts.join(" / ") : v.title;
}
function isHero(img: ImageLite | undefined): boolean {
  return !!img && (img.imageType === "hero" || img.imageType === "hero-flat");
}

export interface RederiveChange {
  variantId: string;
  variantLabel: string;
  fromImageId: string | null;
  toImageId: string;
  fromOwnerLabel: string | null;
  toOwnerLabel: string;
  reason: string;
}
export interface RederivePlan {
  productId: string;
  changes: RederiveChange[];
  consideredVariants: number;
  skippedHeroed: number;
  skippedNoCandidate: number;
}

/**
 * Compute (read-only) the set of featuredImageId changes that would make each
 * variant point at the source swatch matching its finish + size. Pure: performs
 * no writes.
 */
export async function computeRederivePlan(productId: string): Promise<RederivePlan> {
  const [variants, images] = await Promise.all([
    prisma.variant.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        title: true,
        option1: true,
        option2: true,
        option3: true,
        isHidden: true,
        featuredImageId: true,
      },
    }),
    prisma.productImage.findMany({
      where: { productId },
      select: {
        id: true,
        variantId: true,
        storagePath: true,
        sourceUrl: true,
        fileName: true,
        imageType: true,
        position: true,
      },
    }),
  ]);

  const vById = new Map<string, VariantLite>(variants.map((v) => [v.id, v]));

  // Source-linked swatches (ground truth): owner variant gives finish + size.
  const sourceMeta = images
    .filter((img) => img.variantId && !isHero(img))
    .map((img) => {
      const owner = vById.get(img.variantId!);
      return owner
        ? { img, finish: finishKeyOf(owner.option1), size: sizeCmOf(optsOf(owner)), isHero: false }
        : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Map heroes back to the source swatch they were generated from (the hero's
  // fileName/storagePath stem is the sanitised source storagePath), so a hero
  // inherits its source's finish + size and can serve as a candidate. Lets us
  // repoint a variant that's stuck on a wrong-size hero onto the correct hero.
  const sourceByGroupKey = new Map<string, (typeof sourceMeta)[number]>();
  for (const s of sourceMeta) {
    const key = heroGroupKeyOf(s.img.storagePath || s.img.sourceUrl);
    if (!sourceByGroupKey.has(key)) sourceByGroupKey.set(key, s);
  }
  const heroMeta = images
    .filter((img) => isHero(img))
    .map((img) => {
      const stem = (img.fileName || "").replace(/\.png$/i, "");
      const src = sourceByGroupKey.get(stem);
      return src ? { img, finish: src.finish, size: src.size, isHero: true } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const candidates = [...sourceMeta, ...heroMeta];
  const metaByImageId = new Map(candidates.map((c) => [c.img.id, c]));

  const plan: RederivePlan = {
    productId,
    changes: [],
    consideredVariants: 0,
    skippedHeroed: 0,
    skippedNoCandidate: 0,
  };
  if (candidates.length === 0) return plan;

  // score: +2 finish agreement, +2 size agreement (within tolerance).
  const score = (
    vFinish: string,
    vSize: number | null,
    cFinish: string,
    cSize: number | null,
  ): number => {
    let s = 0;
    if (vFinish && cFinish && vFinish === cFinish) s += 2;
    if (vSize !== null && cSize !== null && Math.abs(vSize - cSize) <= SIZE_TOLERANCE_CM) s += 2;
    return s;
  };

  // Tie-break helper: higher score, then prefer a hero, then nearer size, then
  // lower position. Deterministic.
  const better = (
    a: { score: number; isHero: boolean; sizeDiff: number; position: number },
    b: { score: number; isHero: boolean; sizeDiff: number; position: number },
  ): boolean => {
    if (a.score !== b.score) return a.score > b.score;
    if (a.isHero !== b.isHero) return a.isHero;
    if (a.sizeDiff !== b.sizeDiff) return a.sizeDiff < b.sizeDiff;
    return a.position < b.position;
  };

  for (const v of variants) {
    plan.consideredVariants++;

    const vFinish = finishKeyOf(v.option1);
    const vSize = sizeCmOf(optsOf(v));

    // Only consider candidates that agree on finish (avoids cross-colour bleed).
    const viable = vFinish ? candidates.filter((c) => c.finish === vFinish) : [];
    if (viable.length === 0) {
      plan.skippedNoCandidate++;
      continue;
    }

    const rank = (c: (typeof candidates)[number]) => ({
      score: score(vFinish, vSize, c.finish, c.size),
      isHero: c.isHero,
      sizeDiff: vSize !== null && c.size !== null ? Math.abs(c.size - vSize) : Number.POSITIVE_INFINITY,
      position: c.img.position,
    });
    let best = viable[0];
    let bestRank = rank(best);
    for (const c of viable.slice(1)) {
      const r = rank(c);
      if (better(r, bestRank)) {
        best = c;
        bestRank = r;
      }
    }

    // Current match quality: a source-linked or hero image we can score, else weak.
    const currentMeta = v.featuredImageId ? metaByImageId.get(v.featuredImageId) : undefined;
    const currentScore = currentMeta
      ? score(vFinish, vSize, currentMeta.finish, currentMeta.size)
      : v.featuredImageId
        ? 0 // points at an unscoreable image (e.g. gallery row) → weak
        : -1; // no featured image at all → filling is an improvement

    if (best.img.id === v.featuredImageId) continue; // already correct
    if (bestRank.score <= currentScore) continue; // do-no-harm: not strictly better

    plan.changes.push({
      variantId: v.id,
      variantLabel: labelOf(v),
      fromImageId: v.featuredImageId,
      toImageId: best.img.id,
      fromOwnerLabel: currentMeta ? `score ${currentScore}${currentMeta.isHero ? " hero" : ""}` : null,
      toOwnerLabel: `finish=${best.finish} size=${best.size ?? "?"}cm${best.isHero ? " (hero)" : ""}`,
      reason: `variant finish="${vFinish}" size=${vSize ?? "?"}cm → ${best.isHero ? "hero" : "swatch"} (score ${currentScore}→${bestRank.score})`,
    });
  }

  return plan;
}

/**
 * Apply the re-derivation. With `apply: false` (default) returns the plan without
 * writing. Idempotent — a second run produces no changes.
 */
export async function rederiveVariantFeaturedImages(
  productId: string,
  opts?: { apply?: boolean },
): Promise<RederivePlan> {
  const plan = await computeRederivePlan(productId);
  if (opts?.apply && plan.changes.length > 0) {
    await prisma.$transaction(
      plan.changes.map((c) =>
        prisma.variant.update({
          where: { id: c.variantId },
          data: { featuredImageId: c.toImageId },
        }),
      ),
    );
  }
  return plan;
}
