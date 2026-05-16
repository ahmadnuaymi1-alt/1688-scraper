/**
 * Variant image auto-fill.
 *
 * For each visible variant with NO featuredImageId, find another visible
 * variant on the same product that DOES have one and shares the most option
 * values, then copy its featuredImageId over. Lets a user one-click resolve
 * the common 1688 case where a swatch came in attached to one (Design, Finish)
 * tuple but the same tuple repeats across multiple battery sizes / capacities /
 * etc. — visually identical variants share an image without making the user
 * click through the picker for each row.
 *
 * The algorithm scores candidates by the count of (option1, option2, option3)
 * slots where both values are non-null AND case-insensitive-equal. The
 * threshold is half the product's non-null axis count rounded up, so:
 *   - 1-axis product → need 1 axis match
 *   - 2-axis product → need 1 axis match
 *   - 3-axis product → need 2 axis matches  (avoids the wrong-design case
 *     where Beacon Base/Gold would otherwise inherit Halo/Gold's image off
 *     a single shared axis)
 *
 * Hidden variants are skipped — they're not going to Shopify either way.
 */

import { prisma } from "@/lib/db";

export interface AutofillDetail {
  variantId: string;
  variantLabel: string;
  sourceVariantId: string;
  sourceLabel: string;
  imageId: string;
  score: number;
}

export interface AutofillResult {
  filled: number;
  skippedNoMatch: number;
  alreadyFilled: number;
  threshold: number;
  details: AutofillDetail[];
}

function labelFor(v: { option1: string | null; option2: string | null; option3: string | null; title: string }): string {
  const parts = [v.option1, v.option2, v.option3].filter((s): s is string => !!s && s.trim() !== "");
  return parts.length > 0 ? parts.join(" / ") : v.title;
}

function normalizedSlot(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  return t === "" ? null : t;
}

function scoreShare(
  a: { option1: string | null; option2: string | null; option3: string | null },
  b: { option1: string | null; option2: string | null; option3: string | null },
): number {
  let score = 0;
  for (const slot of ["option1", "option2", "option3"] as const) {
    const av = normalizedSlot(a[slot]);
    const bv = normalizedSlot(b[slot]);
    if (av !== null && bv !== null && av === bv) score++;
  }
  return score;
}

export async function autoFillVariantImages(
  productId: string,
): Promise<AutofillResult> {
  const variants = await prisma.variant.findMany({
    where: { productId, isHidden: false },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      option1: true,
      option2: true,
      option3: true,
      position: true,
      featuredImageId: true,
    },
  });

  // Pre-load the set of valid image IDs on this product so we don't try to
  // copy a featuredImageId pointing at a row that's since been deleted.
  const images = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });
  const validImageIds = new Set(images.map((i) => i.id));

  // How many of the three axis slots are populated *anywhere* on this product?
  // Determines the match threshold per the doc-comment formula.
  const anyOption1 = variants.some((v) => normalizedSlot(v.option1) !== null);
  const anyOption2 = variants.some((v) => normalizedSlot(v.option2) !== null);
  const anyOption3 = variants.some((v) => normalizedSlot(v.option3) !== null);
  const nonNullAxes = (anyOption1 ? 1 : 0) + (anyOption2 ? 1 : 0) + (anyOption3 ? 1 : 0);
  const threshold = Math.max(1, Math.ceil(nonNullAxes / 2));

  const donors = variants.filter(
    (v) => v.featuredImageId !== null && validImageIds.has(v.featuredImageId),
  );
  const targets = variants.filter((v) => v.featuredImageId === null);
  const alreadyFilled = variants.length - targets.length;

  const details: AutofillDetail[] = [];
  let skippedNoMatch = 0;

  for (const target of targets) {
    let best: { donor: typeof donors[number]; score: number } | null = null;
    for (const donor of donors) {
      const score = scoreShare(target, donor);
      if (score < threshold) continue;
      if (
        best === null ||
        score > best.score ||
        (score === best.score &&
          Math.abs(donor.position - target.position) <
            Math.abs(best.donor.position - target.position))
      ) {
        best = { donor, score };
      }
    }
    if (!best || best.donor.featuredImageId === null) {
      skippedNoMatch++;
      continue;
    }
    details.push({
      variantId: target.id,
      variantLabel: labelFor(target),
      sourceVariantId: best.donor.id,
      sourceLabel: labelFor(best.donor),
      imageId: best.donor.featuredImageId,
      score: best.score,
    });
  }

  if (details.length > 0) {
    await prisma.$transaction(
      details.map((d) =>
        prisma.variant.update({
          where: { id: d.variantId },
          data: { featuredImageId: d.imageId },
        }),
      ),
    );
  }

  return {
    filled: details.length,
    skippedNoMatch,
    alreadyFilled,
    threshold,
    details,
  };
}
