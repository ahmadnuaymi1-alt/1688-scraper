/**
 * Gallery preset ordering.
 *
 * One-click reorder of all ProductImage rows for a product into the canonical
 * dropshipping pattern the user shipped to Shopify:
 *
 *   1. Lead variant's featured image (first row of the variant table, visible
 *      only). Usually a hero from /hero-image-creator. Falls back to whatever
 *      that variant's featuredImageId points at if not a hero.
 *   2. Every lifestyle image (imageType="lifestyle"), in their current
 *      position order.
 *   3. Every subsequent visible variant's featured image, in variant-row order
 *      (skipping the lead's, which is already at position 1, and skipping any
 *      duplicate image IDs).
 *   4. Everything else (source/swatch rows, sister rows, orphan lifestyles
 *      that didn't have a placement, anything missed), in their existing
 *      position order.
 *
 * Persisted positions are 0..N-1. The uploader sorts by position ascending
 * when pushing to Shopify, so this is also what Shopify will see.
 */

import { prisma } from "@/lib/db";

export interface ApplyGalleryPresetResult {
  totalImages: number;
  leadHeroImageId: string | null;
  lifestyleCount: number;
  trailingHeroCount: number;
  remainderCount: number;
}

export async function applyGalleryPreset(
  productId: string,
): Promise<ApplyGalleryPresetResult> {
  // Pull visible variants in row order — they drive the hero placement.
  const variants = await prisma.variant.findMany({
    where: { productId, isHidden: false },
    orderBy: { position: "asc" },
    select: { id: true, position: true, featuredImageId: true },
  });

  // Pull every image on this product. Order by current position so step 4's
  // "everything else" bucket retains the user's prior arrangement.
  const images = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, imageType: true },
  });

  const validIds = new Set(images.map((i) => i.id));
  const placed = new Set<string>();
  const order: string[] = [];

  function placeIfValid(id: string | null | undefined): boolean {
    if (!id || placed.has(id) || !validIds.has(id)) return false;
    order.push(id);
    placed.add(id);
    return true;
  }

  // 1. Lead variant's featured image.
  const leadVariant = variants[0];
  let leadHeroImageId: string | null = null;
  if (leadVariant?.featuredImageId && placeIfValid(leadVariant.featuredImageId)) {
    leadHeroImageId = leadVariant.featuredImageId;
  }

  // 2. All lifestyle images, in current position order.
  let lifestyleCount = 0;
  for (const img of images) {
    if (img.imageType === "lifestyle" && placeIfValid(img.id)) {
      lifestyleCount++;
    }
  }

  // 3. Subsequent variants' featured images, in row order.
  let trailingHeroCount = 0;
  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    if (v.featuredImageId && placeIfValid(v.featuredImageId)) {
      trailingHeroCount++;
    }
  }

  // 4. Everything else, in current position order.
  let remainderCount = 0;
  for (const img of images) {
    if (placeIfValid(img.id)) {
      remainderCount++;
    }
  }

  // Sanity: every image should be in `order` exactly once.
  if (order.length !== images.length) {
    throw new Error(
      `applyGalleryPreset internal error: ordered ${order.length} of ${images.length} images`,
    );
  }

  // Persist new positions in a single transaction.
  await prisma.$transaction(
    order.map((id, index) =>
      prisma.productImage.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );

  return {
    totalImages: images.length,
    leadHeroImageId,
    lifestyleCount,
    trailingHeroCount,
    remainderCount,
  };
}
