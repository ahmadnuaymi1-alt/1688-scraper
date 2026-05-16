/**
 * Parses 1688 detail-page HTML (as fetched by Bright Data Web Unlocker) to
 * extract per-variant button thumbnails from the embedded `skuProps` JSON.
 *
 * 1688 embeds variant data in the page's inline JSON state. The schema we've
 * verified empirically (offer 816716920435, 2026-05-01):
 *
 *   "skuProps": [
 *     {
 *       "fid": 7853,
 *       "prop": "灯光颜色",       // axis name (Chinese)
 *       "value": [                  // NOTE: singular "value", not "values"
 *         {
 *           "imageUrl": "https://cbu01.alicdn.com/img/...",
 *           "name": "软管百褶落地灯（白杆+白罩子）"  // option value (Chinese)
 *         },
 *         ...
 *       ]
 *     }
 *   ]
 *
 * Returns the FIRST skuProps entry's values, in their original order. Caller
 * matches them to local variants by position (the extractor's variantsFromSpecs
 * preserves the same order from the original Apify spec list).
 */

export interface VariantImageMap {
  /**
   * Variant images in the order they appear in the FIRST imageful axis.
   * Kept for backward compatibility with `attachVariantSwatches`.
   * `value` is the original Chinese option name; `imageUrl` is the 1688 CDN URL.
   */
  ordered: Array<{ value: string; imageUrl: string }>;
  /** Quick lookup by raw Chinese option name (first imageful axis only). */
  byValue: Map<string, string>;
  /**
   * v23 — ALL axes from the same skuProps[] entry, in source order.
   * Each axis carries its own value list. `imageUrl` is null for axes that
   * don't carry per-option thumbnails (e.g. text-only "Light Color" axis).
   * Used to detect multi-axis listings Apify saw as single-axis, so we can
   * Cartesian-expand variants downstream.
   */
  axes: SkuPropAxis[];
}

export interface SkuPropAxis {
  /** The Chinese axis name (e.g. "款式" or "灯光颜色"). */
  name: string;
  /** Values on this axis, in source order. */
  values: Array<{ value: string; imageUrl: string | null }>;
}

/**
 * Find the first balanced JSON array starting at the given index in `text`.
 * Handles nested brackets + escaped quotes inside strings.
 * Returns the substring of the array (including outer brackets), or null.
 */
function readBalancedArray(text: string, openIdx: number): string | null {
  if (text[openIdx] !== "[") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Pull all skuProps array literals out of the HTML. There may be more than one
 * (1688 sometimes embeds the same data in multiple script tags). Returns the
 * parsed object of the first one whose first entry has a non-empty `value`
 * array with at least one `imageUrl`.
 */
export function extractSkuPropsFromHtml(html: string): VariantImageMap | null {
  // The key always appears as `"skuProps":[...]` inside JSON state.
  const keyRegex = /"skuProps"\s*:\s*\[/g;
  let match: RegExpExecArray | null;
  while ((match = keyRegex.exec(html)) !== null) {
    // Find the position of the opening bracket
    const openIdx = match.index + match[0].length - 1;
    const arraySrc = readBalancedArray(html, openIdx);
    if (!arraySrc) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(arraySrc);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) continue;

    // v23: parse ALL axes from this skuProps array, not just the first
    // imageful one. Multi-axis listings (e.g. Style + Light Color) embed every
    // axis here; we surface all of them so downstream can Cartesian-expand
    // variants when Apify only saw one axis.
    const allAxes: SkuPropAxis[] = [];
    let firstImagefulOrdered: Array<{ value: string; imageUrl: string }> = [];
    const firstImagefulByValue = new Map<string, string>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const vals = (entry as { value?: unknown }).value;
      const propName = (entry as { prop?: unknown }).prop;
      if (!Array.isArray(vals) || vals.length === 0) continue;

      const axisValues: Array<{ value: string; imageUrl: string | null }> = [];
      let imagefulCount = 0;
      for (const v of vals) {
        if (!v || typeof v !== "object") continue;
        const name = (v as { name?: unknown }).name;
        const imageUrl = (v as { imageUrl?: unknown }).imageUrl;
        if (typeof name !== "string" || !name.trim()) continue;
        if (typeof imageUrl === "string" && imageUrl.length > 0) {
          const fullUrl = imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl;
          axisValues.push({ value: name.trim(), imageUrl: fullUrl });
          imagefulCount++;
        } else {
          axisValues.push({ value: name.trim(), imageUrl: null });
        }
      }
      if (axisValues.length === 0) continue;

      allAxes.push({
        name: typeof propName === "string" ? propName : "",
        values: axisValues,
      });

      // First imageful axis populates the legacy `ordered` / `byValue` fields
      // for back-compat with attachVariantSwatches. We pick the first axis
      // that has ≥1 imageUrl (the "swatch axis").
      if (firstImagefulOrdered.length === 0 && imagefulCount > 0) {
        firstImagefulOrdered = axisValues
          .filter((v): v is { value: string; imageUrl: string } => v.imageUrl !== null)
          .map((v) => ({ value: v.value, imageUrl: v.imageUrl as string }));
        for (const v of firstImagefulOrdered) firstImagefulByValue.set(v.value, v.imageUrl);
      }
    }

    if (allAxes.length === 0) continue;
    return {
      ordered: firstImagefulOrdered,
      byValue: firstImagefulByValue,
      axes: allAxes,
    };
  }
  return null;
}
