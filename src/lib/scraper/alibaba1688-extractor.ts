/**
 * 1688.com (Alibaba domestic China) extractor — Bright Data only.
 *
 * Plain async function (no class inheritance, no platform-detection scaffolding).
 * Takes pre-fetched HTML and optional description HTML, returns a ScrapedProduct.
 *
 * Pipeline:
 *   parsePageState → extract variants from skuProps Cartesian → attach swatches
 *   → resolve weight from packing table → resolve packaging dims.
 *
 * URL formats:
 *   https://detail.1688.com/offer/{offerId}.html
 *   https://m.1688.com/offer/{offerId}.html
 */

import type { ScrapedProduct, ScrapedVariant, ScrapedImage } from "@/types/product";
import { fetch1688Description } from "./desc-fetcher";
import { extractSkuPropsFromHtml, type SkuPropAxis } from "./sku-props-parser";
import { parsePageState, type Bd1688Product } from "./page-state-parser";
import { deriveHandle } from "@/lib/handle";

/**
 * Variant values that signal "buyer supplies their own bulb" — packaging quirk
 * for B2B buyers, noise on a luxury PDP. Drop these variants entirely.
 */
const NO_BULB_VALUE =
  /^(?:no\s?bulb|no\s?led|no\s?light|without\s?bulb|无灯泡|不含灯泡|无光源|不含光源|裸灯)\s*$/i;

/**
 * Spec keys that contain origin / supplier / shipping metadata — drop from
 * the rendered description's spec table so the storefront doesn't expose
 * "made in China / MOQ / 7 day return" rows that read as dropshipping.
 */
const DROP_SPEC_KEYS =
  /^(?:产地|起订量|MOQ|item\s*no|model\s*number|supplier|export|trademark|certification|认证|货号|3C证书|跨境|after-?sales?|trade\s*terms|delivery\s*time|发货)/i;

/** Pull the numeric offerId out of a 1688 detail URL (e.g. /offer/123456789.html). */
function extractOfferIdFromUrl(url: string): string | null {
  try {
    const m = url.match(/\/offer\/(\d+)\.html/);
    if (m) return m[1];
    const m2 = url.match(/offerId=(\d+)/);
    if (m2) return m2[1];
    return null;
  } catch {
    return null;
  }
}

export interface Extract1688Input {
  html: string;
  descriptionHtml?: string;
  sourceUrl: string;
}

/**
 * Main entry point: takes Bright Data-fetched HTML and returns a ScrapedProduct.
 * If `descriptionHtml` is provided it is used directly; otherwise the function
 * attempts to fetch the description from the offer's itemcdn link found in the
 * page state.
 */
export async function extract1688(input: Extract1688Input): Promise<ScrapedProduct> {
  const { html, sourceUrl } = input;

  const offerId = extractOfferIdFromUrl(sourceUrl);
  if (!offerId) {
    throw new Error(`1688 extractor: could not extract offerId from URL ${sourceUrl}`);
  }

  // 1) Parse the inline JSON state into a Bd1688Product.
  const product = parsePageState(html, offerId);
  if (!product) {
    throw new Error(
      "1688 extractor: parsePageState returned null (couldn't find title in HTML)",
    );
  }

  // 2) Pull variant axes (skuProps) from the same HTML.
  const parsedSkuProps = extractSkuPropsFromHtml(html);

  // 3) Description HTML: prefer caller-supplied; else fetch from itemcdn.
  let descriptionHtml: string | null = null;
  let descriptionImageUrls: string[] = [];
  if (typeof input.descriptionHtml === "string" && input.descriptionHtml.length > 0) {
    descriptionHtml = input.descriptionHtml;
  } else {
    const description = await fetch1688Description(product.descriptionUrl);
    if (description) {
      descriptionHtml = description.html;
      descriptionImageUrls = description.imageUrls;
    }
  }

  // 4) Assemble ScrapedProduct (with a single Default-Title placeholder variant).
  const built = buildScrapedProduct(product, sourceUrl, descriptionHtml, descriptionImageUrls);

  // Variant build: when skuProps yielded axes, do a Cartesian product over
  // them. When skuProps is missing or empty, leave the placeholder variant —
  // this is a single-variant product (e.g. a simple item with no axes).
  if (parsedSkuProps && parsedSkuProps.axes && parsedSkuProps.axes.length > 0) {
    buildVariantsFromAxes(built, parsedSkuProps.axes, product);
  }

  // 5) Attach per-color thumbnails to variants (matched by Chinese option value).
  if (parsedSkuProps && parsedSkuProps.ordered.length > 0) {
    attachVariantSwatches(built, parsedSkuProps.ordered);
  }

  // 6) Drop "no bulb" packaging-quirk variants.
  dropNoBulbVariants(built);

  return built;
}

// -----------------------------------------------------------------------------
// Variant / axis builders
// -----------------------------------------------------------------------------

/**
 * Build variants from BD's axis set as the Cartesian product across all axes.
 * Maps values left-to-right onto option1/option2/option3 (capped at 3 axes
 * per Shopify's limit). Per-variant prices come from the placeholder variant
 * established during initial assembly (which already pulled price from the
 * Bd1688Product.price field).
 */
function buildVariantsFromAxes(
  p: ScrapedProduct,
  brightDataAxes: SkuPropAxis[],
  bdProduct: Bd1688Product,
): void {
  if (!brightDataAxes || brightDataAxes.length === 0) return;

  const cappedAxes = brightDataAxes.slice(0, 3);
  const valueLists = cappedAxes.map((a) => a.values.map((v) => v.value));
  if (valueLists.some((l) => l.length === 0)) return;

  const cart = (lists: string[][]): string[][] => {
    const out: string[][] = [];
    const helper = (idx: number, current: string[]): void => {
      if (idx === lists.length) {
        out.push([...current]);
        return;
      }
      for (const v of lists[idx]) {
        current.push(v);
        helper(idx + 1, current);
        current.pop();
      }
    };
    helper(0, []);
    return out;
  };
  const combos = cart(valueLists);
  if (combos.length === 0) return;

  const proto = p.variants[0];
  const protoPrice = proto?.price ?? "0.00";
  const protoCompareAtPrice = proto?.compareAtPrice;
  const protoSupplierCost = proto?.supplierCost ?? protoPrice;
  const protoWeight = proto?.weight;
  const protoWeightUnit = proto?.weightUnit;
  const protoPackagingDimensions = proto?.packagingDimensions;

  // Prefer source-derived id prefix; fall back to the offer ID.
  let idPrefix: string | null = null;
  for (const v of p.variants) {
    if (typeof v.sourceVariantId === "string" && v.sourceVariantId) {
      idPrefix = v.sourceVariantId.replace(/-(?:bd-v)?\d+$/, "");
      break;
    }
  }
  if (!idPrefix) idPrefix = bdProduct.offerId;

  const newVariants: ScrapedVariant[] = combos.map((combo, idx) => {
    const position = idx + 1;
    const o1 = combo[0];
    const o2 = combo[1];
    const o3 = combo[2];

    const variant: ScrapedVariant = {
      title: combo.filter(Boolean).join(" / ") || `Variant ${position}`,
      price: protoPrice,
      position,
      sourceVariantId: `${idPrefix}-bd-v${position}`,
      supplierCost: protoSupplierCost,
    };
    if (typeof o1 === "string") variant.option1 = o1;
    if (typeof o2 === "string") variant.option2 = o2;
    if (typeof o3 === "string") variant.option3 = o3;
    if (typeof protoCompareAtPrice === "string") variant.compareAtPrice = protoCompareAtPrice;
    if (typeof protoWeight === "number") variant.weight = protoWeight;
    if (protoWeightUnit) variant.weightUnit = protoWeightUnit;
    if (typeof protoPackagingDimensions === "string") {
      variant.packagingDimensions = protoPackagingDimensions;
    }
    // Mirror raw Chinese option values into supplierLabel1/2/3 so the curator
    // can still see the original axis-value while the user-facing options get
    // translated downstream.
    if (typeof o1 === "string") variant.supplierLabel1 = o1;
    if (typeof o2 === "string") variant.supplierLabel2 = o2;
    if (typeof o3 === "string") variant.supplierLabel3 = o3;
    return variant;
  });

  p.variants = newVariants;
  p.optionNames = cappedAxes.map((a) => a.name);
}

/**
 * Append BD-fetched variant button thumbnails to the gallery as proper
 * variant-linked ScrapedImages. Match by primary-axis option value (the
 * original Chinese, before any translation runs); fall back to positional
 * alignment when the value-match fails.
 *
 * In the new schema, ScrapedImage links to a single variant via
 * `variantSourceId`. When a swatch matches multiple variants (e.g. all
 * "white" variants across a size axis), we attach the swatch to the FIRST
 * matched variant only — downstream linking can fan it out as needed.
 */
function attachVariantSwatches(
  p: ScrapedProduct,
  swatches: Array<{ value: string; imageUrl: string }>,
): void {
  const urlToImage = new Map<string, ScrapedImage>();
  for (const img of p.images) urlToImage.set(img.sourceUrl, img);

  for (let i = 0; i < swatches.length; i++) {
    const { value: chineseValue, imageUrl } = swatches[i];
    const fullUrl = maximize1688Image(absolute1688Url(imageUrl));
    if (!fullUrl) continue;
    if (isJunkImage(fullUrl)) continue;

    // Find variants whose original-axis value matches the swatch label.
    const matchedVariants: ScrapedVariant[] = [];
    for (const v of p.variants) {
      if (
        v.option1 === chineseValue ||
        v.option2 === chineseValue ||
        v.option3 === chineseValue ||
        v.supplierLabel1 === chineseValue ||
        v.supplierLabel2 === chineseValue ||
        v.supplierLabel3 === chineseValue
      ) {
        matchedVariants.push(v);
      }
    }
    if (matchedVariants.length === 0 && i < p.variants.length) {
      matchedVariants.push(p.variants[i]);
    }
    if (matchedVariants.length === 0) continue;

    const primaryVariant = matchedVariants[0];
    const primarySourceId = primaryVariant.sourceVariantId;

    // Attach to every matched variant's `imageUrl` (if not already set).
    for (const v of matchedVariants) {
      if (!v.imageUrl) v.imageUrl = fullUrl;
    }

    const existing = urlToImage.get(fullUrl);
    if (existing) {
      // Already in gallery — link it to the primary variant if it has no link yet.
      if (!existing.variantSourceId && primarySourceId) {
        existing.variantSourceId = primarySourceId;
      }
      if (!existing.altText) existing.altText = chineseValue;
      continue;
    }

    const newImg: ScrapedImage = {
      sourceUrl: fullUrl,
      altText: chineseValue,
      position: p.images.length + 1,
    };
    if (primarySourceId) newImg.variantSourceId = primarySourceId;
    p.images.push(newImg);
    urlToImage.set(fullUrl, newImg);
  }
}

/** Drop variants whose option values match the "no bulb" packaging quirk. */
function dropNoBulbVariants(p: ScrapedProduct): void {
  if (!p.variants || p.variants.length === 0) return;

  const before = p.variants.length;
  const survivors: ScrapedVariant[] = [];
  for (const v of p.variants) {
    const o1 = typeof v.option1 === "string" ? v.option1 : "";
    const o2 = typeof v.option2 === "string" ? v.option2 : "";
    const o3 = typeof v.option3 === "string" ? v.option3 : "";
    if (NO_BULB_VALUE.test(o1) || NO_BULB_VALUE.test(o2) || NO_BULB_VALUE.test(o3)) {
      continue;
    }
    survivors.push(v);
  }
  const dropped = before - survivors.length;
  if (dropped === 0) return;

  survivors.forEach((v, idx) => {
    v.position = idx + 1;
  });
  p.variants = survivors;
}

// -----------------------------------------------------------------------------
// Build ScrapedProduct
// -----------------------------------------------------------------------------

function buildScrapedProduct(
  p: Bd1688Product,
  sourceUrl: string,
  descriptionHtml: string | null,
  _descImageUrls: string[],
): ScrapedProduct {
  // Initial single-variant placeholder. buildVariantsFromAxes will replace
  // this with the Cartesian product when skuProps yields axes; otherwise
  // (no skuProps) we leave the Default Title variant as-is.
  //
  // 1688's Packing table reports a single product-level weight/dimensions
  // set, so we copy it to every variant.
  const placeholder: ScrapedVariant = {
    title: "Default Title",
    price: priceString(p.price?.min ?? 0),
    position: 1,
    sourceVariantId: p.offerId,
    supplierCost: priceString(p.price?.min ?? 0),
  };
  if (p.price && p.price.max > p.price.min) {
    placeholder.compareAtPrice = priceString(p.price.max);
  }
  if (typeof p.productWeightG === "number") {
    placeholder.weight = p.productWeightG;
    placeholder.weightUnit = "g";
  }
  if (typeof p.productPackagingDimensions === "string") {
    placeholder.packagingDimensions = p.productPackagingDimensions;
  }

  const variants: ScrapedVariant[] = [placeholder];

  const images = buildImages(p);
  const description = buildDescriptionHtml(descriptionHtml);
  const tags = buildTags(p);

  // Title is Chinese at scrape time — slugify produces empty or short ASCII
  // fragments. Use the shared deriveHandle helper so the slug behavior is
  // identical here, in the PATCH route, and in the title-rule applier; offerId
  // is the per-product fallback for short / empty slugs.
  const handle = deriveHandle(p.title, `offer-${p.offerId}`);

  const result: ScrapedProduct = {
    sourceUrl,
    sourcePlatform: "1688",
    title: p.title,
    handle,
    optionNames: [],
    variants,
    images,
    rawPayload: p,
  };

  const vendor = p.supplier?.companyName || p.supplier?.loginId;
  if (vendor) result.vendor = vendor;
  if (tags.length > 0) result.tags = tags;
  if (description) result.descriptionHtml = description;
  if (typeof p.productWeightG === "number") result.productWeightG = p.productWeightG;
  if (typeof p.productPackagingDimensions === "string") {
    result.productPackagingDimensions = p.productPackagingDimensions;
  }

  return result;
}

// -----------------------------------------------------------------------------
// Images
// -----------------------------------------------------------------------------

function buildImages(p: Bd1688Product): ScrapedImage[] {
  const seen = new Set<string>();
  const images: ScrapedImage[] = [];

  for (const url of p.images || []) {
    const full = maximize1688Image(absolute1688Url(url));
    if (!full || seen.has(full)) continue;
    if (isJunkImage(full)) continue;
    seen.add(full);
    images.push({
      sourceUrl: full,
      position: images.length + 1,
    });
  }

  return images;
}

/**
 * Drop 1688 CDN images that are not product photos: "ships overseas" badges,
 * site-icon sprites, generic merchant-logo widgets, tiny thumbnails, etc.
 */
const JUNK_IMAGE_PATTERNS: RegExp[] = [
  /[_-]overseas[_-]?pic/i,
  /[_-]badge[_-]?/i,
  /[_-]icon[_-]?/i,
  /[_-]logo[_-]?/i,
  /[_-]sprite[_-]?/i,
  /[_-]ship(ping)?[_-]/i,
  /[_-]cert(ificate)?[_-]/i,
  /[_-]watermark[_-]?/i,
  /\b\d{2,3}x\d{2,3}\.(jpg|jpeg|png|webp)/i,
];

function isJunkImage(url: string): boolean {
  return JUNK_IMAGE_PATTERNS.some((re) => re.test(url));
}

// -----------------------------------------------------------------------------
// Description HTML
// -----------------------------------------------------------------------------

/**
 * Compose the final description HTML by combining:
 *   1. The seller-written description (from itemcdn — may be Chinese)
 *   2. A filtered specs table parsed from the description's spec lines
 *
 * Downstream the description-translator + smart-image-processor will
 * translate Chinese text + in-image text.
 */
function buildDescriptionHtml(descriptionHtml: string | null): string {
  const parts: string[] = [];

  if (descriptionHtml && descriptionHtml.length > 50) {
    parts.push(descriptionHtml.trim());
  }

  const specTable = buildSpecsTable(descriptionHtml);
  if (specTable) parts.push(specTable);

  return parts.join("\n\n");
}

/**
 * Parse Chinese spec lines out of the description text and render them as a
 * small specs table. Filtered via DROP_SPEC_KEYS so origin / MOQ / cert rows
 * don't leak.
 */
function buildSpecsTable(descriptionHtml: string | null): string {
  if (!descriptionHtml) return "";

  // Strip HTML tags and normalize whitespace so the regex can scan plain text.
  const text = descriptionHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  // Capture short Chinese-style key + value pairs. Key: 1-20 non-colon chars
  // before a Chinese ：or ASCII : ; value: until the next 2-space gap.
  const SPEC_RE =
    /([^\s：:]{1,20})\s*[：:]\s*([^\s][^：:]{0,80}?)(?=\s{2,}|\s[^\s：:]{1,20}\s*[：:]|$)/g;

  const seen = new Set<string>();
  const rows: Array<{ name: string; value: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = SPEC_RE.exec(text)) !== null) {
    const name = m[1].trim();
    const value = m[2].trim();
    if (!name || !value) continue;
    if (DROP_SPEC_KEYS.test(name)) continue;
    const key = `${name}|${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, value });
    if (rows.length >= 30) break;
  }

  if (rows.length === 0) return "";

  const html = rows
    .map((r) => `<tr><th>${escapeHtml(r.name)}</th><td>${escapeHtml(r.value)}</td></tr>`)
    .join("\n");
  return `<table class="product-specs">\n<tbody>\n${html}\n</tbody>\n</table>`;
}

// -----------------------------------------------------------------------------
// Misc field builders
// -----------------------------------------------------------------------------

function buildTags(p: Bd1688Product): string[] {
  const tags: string[] = [`1688:${p.offerId}`];
  if (p.categoryName) tags.push(p.categoryName);
  return tags;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function priceString(price: number): string {
  if (!Number.isFinite(price) || price < 0) return "0.00";
  return price.toFixed(2);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Normalize a URL to absolute (https://). */
function absolute1688Url(url: string): string {
  if (!url) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http")) return url;
  return url;
}

/**
 * Maximize a 1688 alicdn image URL by stripping CDN size suffixes / variant
 * encodings so we download the full-resolution original.
 *
 * Inlined here (rather than importing the legacy per-platform image-resolver)
 * because this project only handles 1688.
 */
function maximize1688Image(url: string): string {
  if (!url) return url;
  try {
    return url
      .replace(/^\/\//, "https://")
      .replace(/_\d+x\d+(q\d+)?(?=\.\w+)/g, "")
      .replace(/(\.\w+)\.(webp|avif)$/, "$1")
      .replace(/_!!\d+(?=\.\w+)/g, "")
      .replace(/_(?:b|sum|400x400|220x220|310x310|600x600)(?=\.\w+)/g, "");
  } catch {
    return url;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
