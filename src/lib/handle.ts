/**
 * Derive a Shopify-compatible product handle from a title.
 *
 * Slugifies (lowercase, alphanumeric-with-dashes only) and appends `fallback`
 * when the slug is too short — common when the title is a Chinese 1688
 * listing (slugify strips all non-ASCII to nothing) or a brief English
 * fragment like "LED" or "USB LED" that would collide across products on
 * Shopify (multiple "LED ..." products all producing handle="led").
 *
 * 16-char floor was tuned to the actual title shapes we see: short
 * marketing fragments fall below it, descriptive product titles clear it.
 *
 * Used everywhere title -> handle conversion happens: scraper extraction,
 * the title transformation rule, manual title edits on the review page.
 * Keeping it in one place means handle behavior never drifts between
 * pipelines.
 */
export function deriveHandle(title: string, fallback: string): string {
  const slug = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  if (!slug) return fallback;
  if (slug.length >= 16) return slug;
  return `${slug}-${fallback}`;
}
