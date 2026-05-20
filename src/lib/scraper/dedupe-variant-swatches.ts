import crypto from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";

export interface DedupeVariantSwatchesResult {
  /** Number of swatch rows examined. */
  rowsExamined: number;
  /** Number of distinct content groups identified. */
  groupsExamined: number;
  /** Number of ProductImage rows deleted because they were duplicates. */
  duplicatesCollapsed: number;
  /** Number of Variant rows whose featuredImageId was repointed onto the canonical row. */
  variantsRepointed: number;
  /** Rows that failed to download for fingerprinting; left untouched. */
  skipped: number;
}

interface SwatchRow {
  id: string;
  sourceUrl: string;
  storagePath: string | null;
  variantId: string | null;
  position: number;
}

const DOWNLOAD_TIMEOUT_MS = 15_000;
/** Resize-to side length used for the perceptual hash. */
const HASH_RESIZE = 32;
/** Grayscale-quantization bit depth (4 → 16 levels, ±8 jitter tolerance). */
const HASH_QUANT_BITS = 4;

/**
 * Compute a perceptual content key for an image at a URL.
 *
 * Strategy: decode → resize to HASH_RESIZE × HASH_RESIZE grayscale (drops
 * JPEG metadata and harmonises encoder differences) → quantize each pixel
 * to HASH_QUANT_BITS levels (absorbs ±8 jitter from re-encoding) → md5
 * the byte buffer. Two images with the same content end up at the same
 * key even if their on-disk bytes and CDN URLs differ (alicdn returns
 * different content hashes for re-uploaded images that the seller
 * intended to be identical).
 *
 * Empirically tuned on luxury-lighting swatches: black-vs-brass color
 * differences in the small product silhouette are preserved by the
 * 32×32 / 4-bit setting, while warm-vs-tri-color light-mode-only
 * encoder differences collapse together.
 */
async function contentHashOfUrl(url: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const inBuf = Buffer.from(await res.arrayBuffer());
    const raw = await sharp(inBuf)
      .resize(HASH_RESIZE, HASH_RESIZE, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
    const shift = 8 - HASH_QUANT_BITS;
    const quant = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) quant[i] = raw[i] >> shift;
    return crypto.createHash("md5").update(quant).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Collapse visually-duplicate variant swatch images for a product.
 *
 * Only operates on ProductImage rows that (a) belong to the given
 * product, (b) have a variantId set (i.e. they're swatches linked to a
 * specific variant), and (c) are NOT hero / hero-flat rows. Heroes are
 * intentionally per-variant and excluded.
 *
 * Within each group of rows sharing the same perceptual content hash,
 * the lowest-position row is kept as canonical. Every variant whose
 * featuredImageId pointed at one of the non-canonical rows is repointed
 * to the canonical row, and the non-canonical rows are deleted. The
 * canonical row keeps its own variantId link; sister variants only
 * retain the connection via featuredImageId.
 *
 * Idempotent — re-running yields zero changes on the second pass.
 */
export async function dedupeVariantSwatches(productId: string): Promise<DedupeVariantSwatchesResult> {
  // Prisma's `{ not: X }` filter excludes NULL under SQL 3-valued logic,
  // so an explicit OR is required to include rows where imageType is null
  // (the default for swatches).
  const images: SwatchRow[] = await prisma.productImage.findMany({
    where: {
      productId,
      variantId: { not: null },
      OR: [
        { imageType: null },
        { imageType: { notIn: ["hero", "hero-flat"] } },
      ],
    },
    orderBy: { position: "asc" },
    select: {
      id: true,
      sourceUrl: true,
      storagePath: true,
      variantId: true,
      position: true,
    },
  });

  if (images.length === 0) {
    return { rowsExamined: 0, groupsExamined: 0, duplicatesCollapsed: 0, variantsRepointed: 0, skipped: 0 };
  }

  // Fetch + content-hash every row in parallel. Cheap because alicdn is
  // fast and swatches are small (~50KB each). Rows we can't fetch get a
  // unique synthetic key so they don't accidentally group with anything.
  const hashes = await Promise.all(
    images.map(async (img) => {
      const h = await contentHashOfUrl(img.sourceUrl);
      return { img, hash: h };
    }),
  );

  let skipped = 0;
  const groups = new Map<string, SwatchRow[]>();
  for (const { img, hash } of hashes) {
    const key = hash ?? `nohash:${img.id}`;
    if (hash === null) skipped++;
    const arr = groups.get(key) ?? [];
    arr.push(img);
    groups.set(key, arr);
  }

  let duplicatesCollapsed = 0;
  let variantsRepointed = 0;

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const [canonical, ...rest] = group; // lowest position wins
    const restIds = rest.map((r) => r.id);

    // Repoint every variant whose featured image is in the non-canonical
    // set, plus any variant that owns a non-canonical row directly via
    // ProductImage.variantId (in case its featuredImageId is currently
    // null or pointed elsewhere).
    const variantsByFeatured = await prisma.variant.findMany({
      where: { productId, featuredImageId: { in: restIds } },
      select: { id: true },
    });
    const variantIdsFromRows = rest
      .map((r) => r.variantId)
      .filter((v): v is string => v !== null);

    const allVariantIds = Array.from(
      new Set<string>([
        ...variantsByFeatured.map((v) => v.id),
        ...variantIdsFromRows,
      ]),
    );

    if (allVariantIds.length > 0) {
      const updated = await prisma.variant.updateMany({
        where: { id: { in: allVariantIds } },
        data: { featuredImageId: canonical.id },
      });
      variantsRepointed += updated.count;
    }

    await prisma.productImage.deleteMany({ where: { id: { in: restIds } } });
    duplicatesCollapsed += rest.length;
  }

  return {
    rowsExamined: images.length,
    groupsExamined: groups.size,
    duplicatesCollapsed,
    variantsRepointed,
    skipped,
  };
}
