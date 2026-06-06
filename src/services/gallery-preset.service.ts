/**
 * Gallery preset ordering.
 *
 * One-click reorder of all ProductImage rows for a product into the user's
 * canonical dropshipping pattern:
 *
 *   1. Lead variant's featured image (first row of the variant table, visible
 *      only). Usually a hero from /hero-image-creator. Falls back to whatever
 *      that variant's featuredImageId points at if not a hero.
 *   2. Every lifestyle image (imageType="lifestyle"), in their current
 *      position order.
 *   3. Every starred / "saved" image (keep=true), in their current position
 *      order — captures the user's per-image keep flag from the gallery's
 *      star toggle. Excludes anything already placed in steps 1-2.
 *   4. Every user-uploaded image (storagePath matches the upload route's
 *      pattern `<productId>/upload_*`), in their current position order.
 *      Excludes anything already placed in steps 1-3.
 *   5. Subsequent visible variants' featured images (the remaining heroes),
 *      in variant-row order.
 *   6. Everything else (source/swatch rows, closeups, sister rows, orphan
 *      lifestyles that didn't have a placement, anything missed), in their
 *      existing position order — appended at the very end.
 *
 * Persisted positions are 0..N-1. The uploader sorts by position ascending
 * when pushing to Shopify, so this is also what Shopify will see.
 */

import { prisma } from "@/lib/db";

export interface ApplyGalleryPresetResult {
  totalImages: number;
  leadHeroImageId: string | null;
  lifestyleCount: number;
  starredCount: number;
  uploadedCount: number;
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

  // Pull every image on this product. Order by current position so step 6's
  // "everything else" bucket retains the user's prior arrangement.
  const images = await prisma.productImage.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, imageType: true, keep: true, storagePath: true },
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

  // 3. All starred / "saved" images (keep=true), in current position order.
  //    Anything starred but already placed (e.g. user starred the lead hero
  //    or a lifestyle) doesn't double-count thanks to the placed set.
  let starredCount = 0;
  for (const img of images) {
    if (img.keep && placeIfValid(img.id)) {
      starredCount++;
    }
  }

  // 4. User-uploaded images. The upload route at
  //    src/app/api/products/[id]/images/route.ts:184 writes blobs to
  //    `<productId>/upload_<ms>_<filename>` and sets imageType=null, so the
  //    storagePath prefix is the reliable discriminator vs originally-scraped
  //    1688 photos (which have neither that prefix nor any other clean marker).
  const uploadPrefix = `${productId}/upload_`;
  let uploadedCount = 0;
  for (const img of images) {
    if (
      img.imageType === null &&
      img.storagePath?.startsWith(uploadPrefix) &&
      placeIfValid(img.id)
    ) {
      uploadedCount++;
    }
  }

  // 5. Subsequent variants' featured images (remaining heroes), in row order.
  let trailingHeroCount = 0;
  for (let i = 1; i < variants.length; i++) {
    const v = variants[i];
    if (v.featuredImageId && placeIfValid(v.featuredImageId)) {
      trailingHeroCount++;
    }
  }

  // 6. Everything else (source/swatch/closeup/sister/orphan), in current
  //    position order — appended at the very end.
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
    starredCount,
    uploadedCount,
    trailingHeroCount,
    remainderCount,
  };
}
