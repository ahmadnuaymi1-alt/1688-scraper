/**
 * Parses Bright Data's rendered 1688 detail page HTML into a structured product
 * object. Replaces `scrape1688Product()` from the Apify zen-studio actor, which
 * was unreliable (~10-20% empty skuDetails). Field-by-field regex patterns
 * verified empirically on offers 858955223080 and 945079145506.
 *
 * Returns null when title can't be located (catastrophic parse failure — every
 * other field is treated as optional / best-effort).
 */

/**
 * Subset of the Apify1688Product shape used downstream by the extractor. Lives
 * in this file (not the deleted apify/types.ts) so the parser is self-contained.
 */
/** One row of the 1688 product attributes table. `name` and `value` are usually
 * in Chinese (e.g. name="品牌" value="DIGUI"); downstream translation/structuring
 * handles the rendering to English. */
export interface Bd1688Attribute {
  name: string;
  value: string;
}

export interface Bd1688Product {
  offerId: string;
  title: string;
  descriptionUrl?: string;
  images: string[];
  price: { min: number; max: number; currency: string };
  supplier: { memberId?: string; loginId?: string; companyName?: string };
  categoryName?: string | null;
  categoryId?: string;
  /** Rows from the "Product Attributes" table in the 1688 page state JSON
   * (the `featureAttributes` array). Includes brand, model, voltage, material,
   * certifications, certificate numbers, additional features, applicable
   * scenarios, origin, control type, etc. — usually 15-30 entries. Raw
   * Chinese; gets translated downstream in description-enrichment. */
  featureAttributes: Bd1688Attribute[];
  /** Net product weight in grams, parsed from the "Packing" table's 重量(g)
   * cell. Some listings don't render this — undefined when missing. */
  productWeightG?: number;
  /** Packaging dimensions string (e.g. "30 × 20 × 15 cm"), parsed best-effort
   * from `featureAttributes` rows with names containing 尺寸/规格. Undefined
   * when no dimension-style attribute can be located. */
  productPackagingDimensions?: string;
  /** Per-type rows from the rendered Packing table — when 1688 shows a
   * multi-row table (Type × Length × Width × Height × Volume × Weight). The
   * `type` value matches the variant's name on the page (e.g. "白光" / "暖光").
   * Empty array when the page only has the single product-level packing row. */
  packingDimensionsRows: Bd1688PackingRow[];
}

export interface Bd1688PackingRow {
  /** Variant "Type" cell — usually matches `option1` or `option2` value on
   * the corresponding variant (e.g. "白光", "暖光", "彩光"). Empty for
   * product-level single rows. */
  type: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightG: number | null;
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function parsePositiveNumber(s: string | null): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Decode the most common JSON / HTML escapes that may appear inside captured
 * substrings (e.g. titles that came out of an inline JSON state). We don't
 * need a full JSON parser — just normalize what we observed empirically.
 */
function decodeJsonString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Strip the ` - 阿里巴巴` suffix and `阿里巴巴-?` prefix from a <title> capture. */
function cleanDocTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/\s*-\s*阿里巴巴\s*$/u, "");
  t = t.replace(/^阿里巴巴-?\s*/u, "");
  return t.trim();
}

/**
 * Extract the `featureAttributes` JSON array from the 1688 page state.
 *
 * Shape in source HTML (verified on offer 948177464058):
 *   "featureAttributes":[
 *     {"fid":2176,"name":"品牌","value":"DIGUI","values":["DIGUI"], ...},
 *     {"fid":3151,"name":"型号","value":"BZTD-188","values":["BZTD-188"], ...},
 *     ...
 *   ]
 *
 * We use bracket-counting rather than a naive regex because the array contents
 * include nested objects with their own arrays (e.g. `values`, `decisionValues`).
 */
function parseFeatureAttributes(html: string): Bd1688Attribute[] {
  const startKey = '"featureAttributes":[';
  const start = html.indexOf(startKey);
  if (start < 0) return [];
  const arrStart = start + startKey.length - 1; // points at the opening `[`
  let depth = 0;
  let end = -1;
  for (let i = arrStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const arrText = html.slice(arrStart, end + 1);
  try {
    const arr = JSON.parse(arrText) as Array<{ name?: unknown; value?: unknown }>;
    return arr
      .filter(
        (a): a is { name: string; value: string } =>
          typeof a.name === "string" &&
          typeof a.value === "string" &&
          a.name.trim().length > 0 &&
          a.value.trim().length > 0,
      )
      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }));
  } catch {
    return [];
  }
}

/**
 * Extract net weight (grams) from the "Packing" section's rendered HTML table:
 *   <thead><tr><th class="field-value">重量(g)</th></tr></thead>
 *   <tbody><tr><td class="field-value">600</td></tr></tbody>
 *
 * Caller-side note: the multi-column packing-dimensions table is handled
 * separately by `parsePackingDimensionsRows`, which uses proper column
 * alignment. This regex is the FALLBACK for the simpler "1 header, 1 cell"
 * variant. We require the matched <td> to be the FINAL cell in its row
 * (`</td>...</tr>` follows) so we don't mis-pick the length cell out of a
 * multi-column row.
 *
 * Returns undefined when the cell is missing or non-numeric.
 */
function parseProductWeightG(html: string): number | undefined {
  // Anchor: 重量(g) header → up to 400 chars → <td>NUMBER</td></tr>
  // The trailing `</tr>` requirement is what makes this safe — multi-column
  // packing tables have many <td>s before the row closes, so this won't fire
  // there and the table parser handles them instead.
  const m = html.match(
    /重量\s*\(\s*g\s*\)[\s\S]{0,400}?<td[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/td>\s*<\/tr>/,
  );
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Extract packaging dimensions from the 1688 featureAttributes rows.
 *
 * 1688 listings expose dimensions inconsistently. The most reliable source is
 * the product attributes table (`featureAttributes` JSON array), where rows
 * with Chinese names like "包装尺寸" / "产品尺寸" / "尺寸" / "规格" carry
 * values such as "30*20*15cm" / "30×20×15cm" / "L30 W20 H15".
 *
 * Returns a normalized "L × W × H cm" string when 3 numeric components can be
 * found, otherwise undefined.
 */
function parseProductPackagingDimensions(
  featureAttributes: Bd1688Attribute[],
): string | undefined {
  // Match Chinese AND English dimension-attribute names. Old regex was
  // `/尺寸|规格/` but missed "整体尺寸"; new pattern is broader.
  const KEY_RE = /尺寸|规格|dimension|size|长.*宽.*高/i;
  // The value MUST look like an actual dimension (e.g. "30*20*15cm" or
  // "30 × 20 × 15") — not a packed comma-separated SKU list like
  // "A款金色,A款黑色,..." that some suppliers stuff into the 尺寸 row.
  const VALID_VALUE_RE = /\d+(?:\.\d+)?\s*[xX×*]\s*\d+(?:\.\d+)?/;
  for (const attr of featureAttributes) {
    if (!KEY_RE.test(attr.name)) continue;
    if (!VALID_VALUE_RE.test(attr.value)) continue;
    const nums = attr.value.match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 3) continue;
    return `${nums[0]} × ${nums[1]} × ${nums[2]} cm`;
  }
  return undefined;
}

/**
 * Parse the 1688 Packing section's per-variant dimension table when present.
 *
 * The table renders as standard HTML inside the packing section. Header row
 * has columns like (Chinese): 类型 | 长(cm) | 宽(cm) | 高(cm) | 体积(cm³) | 重量(g),
 * or the English equivalents. We locate it by finding the header signature
 * (length-cm column adjacent to weight-g column) and then walk the tbody
 * rows.
 *
 * Returns [] when the table isn't present (some listings have a single
 * product-level row only — productWeightG covers that case).
 */
function parsePackingDimensionsRows(html: string): Bd1688PackingRow[] {
  // Find a block that starts at a length-cm column header and contains a
  // weight-g column header within ~3000 chars (full table headers + a few
  // rows of body). Then read up to ~8000 chars of subsequent rows.
  const sigMatch = html.match(
    /(?:长|Length)\s*\(\s*cm\s*\)[\s\S]{0,3000}?(?:重量|Weight)\s*\(\s*g\s*\)([\s\S]{0,8000})/,
  );
  if (!sigMatch) return [];

  // Within the captured body, walk <tr> rows.
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const rows: Bd1688PackingRow[] = [];
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(sigMatch[1])) !== null) {
    // Strip nested tags from each <td> cell text.
    const cellMatches = Array.from(m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g));
    const cellTexts = cellMatches.map((c) =>
      c[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .trim(),
    );
    if (cellTexts.length < 4) continue; // need at least Type + L + W + H

    const type = cellTexts[0];
    const lengthCm = parsePositiveNumber(cellTexts[1]);
    const widthCm = parsePositiveNumber(cellTexts[2]);
    const heightCm = parsePositiveNumber(cellTexts[3]);
    // Weight is the LAST numeric cell (after the optional volume column).
    let weightG: number | null = null;
    for (let i = cellTexts.length - 1; i >= 4; i--) {
      const n = parsePositiveNumber(cellTexts[i]);
      if (n !== null && n > 0) {
        weightG = n;
        break;
      }
    }
    // Skip header-echo rows or rows where L/W/H are all null.
    if (lengthCm === null && widthCm === null && heightCm === null) continue;
    rows.push({ type, lengthCm, widthCm, heightCm, weightG });
  }
  return rows;
}

export function parsePageState(html: string, offerId: string): Bd1688Product | null {
  // ---- title ----
  let title: string | null = null;
  const subjectMatch = html.match(/"subject"\s*:\s*"([^"]+)"/);
  if (subjectMatch) title = decodeJsonString(subjectMatch[1]);
  if (!title) {
    const offerTitleMatch = html.match(/"offerTitle"\s*:\s*"([^"]+)"/);
    if (offerTitleMatch) title = decodeJsonString(offerTitleMatch[1]);
  }
  if (!title) {
    const docTitleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (docTitleMatch) title = cleanDocTitle(decodeJsonString(docTitleMatch[1]));
  }
  if (!title) return null;

  // ---- price ----
  const minRaw = firstMatch(html, [
    /"discountPrice"\s*:\s*"?([\d.]+)"?/,
    /"productPrice"\s*:\s*"?([\d.]+)"?/,
    /"sellPrice"\s*:\s*"?([\d.]+)"?/,
  ]);
  const priceMin = parsePositiveNumber(minRaw) ?? 0;

  const maxRaw = firstMatch(html, [
    /"priceMax"\s*:\s*"?([\d.]+)"?/,
    /"maxPrice"\s*:\s*"?([\d.]+)"?/,
  ]);
  const priceMax = parsePositiveNumber(maxRaw) ?? priceMin;

  // ---- images ----
  // 1688 page state stores the canonical product gallery in `offerImgList` (a
  // JSON array of CDN URLs). Targeting that key directly avoids picking up
  // description-embedded images, supplier-store banners, category cross-sell
  // tiles, footer widgets, etc. — which the old "match any alicdn URL on the
  // page" approach pulled in (typically 60-70 URLs per listing, mostly junk).
  //
  // Fallback chain: offerImgList → mainImageList → broad regex (capped).
  const IMAGE_URL_RE =
    /https?:\/\/cbu01\.alicdn\.com\/img\/ibank\/[A-Za-z0-9_!\-.]+\.(?:jpg|png|jpeg|webp)/g;

  const extractFromJsonArrayKey = (key: string): string[] => {
    const re = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]+)\\]`, "g");
    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(re)) {
      const arrayContents = m[1];
      for (const um of arrayContents.matchAll(IMAGE_URL_RE)) {
        if (!seen.has(um[0])) {
          seen.add(um[0]);
          out.push(um[0]);
        }
      }
    }
    return out;
  };

  let images = extractFromJsonArrayKey("offerImgList");
  if (images.length === 0) images = extractFromJsonArrayKey("mainImageList");

  if (images.length === 0) {
    // Last-resort fallback: broad regex (legacy behavior). Cap at 20 so a
    // listing with hundreds of inline alicdn URLs doesn't bloat downloads.
    const imageSet = new Set<string>();
    for (const m of html.matchAll(IMAGE_URL_RE)) {
      imageSet.add(m[0]);
      if (imageSet.size >= 20) break;
    }
    images = Array.from(imageSet);
  }

  // ---- descriptionUrl ----
  // The JSON key is `detailUrl` (despite the variable name — verified empirically;
  // 1688's state misnames `descUrl` as `detailUrl`).
  let descriptionUrl: string | undefined;
  const descMatch = html.match(/"detailUrl"\s*:\s*"(https:\/\/itemcdn\.tmall\.com\/[^"]+)"/);
  if (descMatch) {
    // Rewrite escaped slashes (\/) commonly seen in inline JSON.
    descriptionUrl = descMatch[1].replace(/\\\//g, "/");
  }

  // ---- supplier ----
  const supplier: Bd1688Product["supplier"] = {};
  const memberIdMatch = html.match(/"memberId"\s*:\s*"([^"]+)"/);
  if (memberIdMatch) supplier.memberId = decodeJsonString(memberIdMatch[1]);
  const loginIdMatch = html.match(/"loginId"\s*:\s*"([^"]+)"/);
  if (loginIdMatch) supplier.loginId = decodeJsonString(loginIdMatch[1]);
  const companyNameMatch = html.match(/"companyName"\s*:\s*"([^"]+)"/);
  if (companyNameMatch) supplier.companyName = decodeJsonString(companyNameMatch[1]);

  // ---- category ----
  let categoryName: string | null | undefined;
  const catNameMatch = html.match(/"leafCategoryName"\s*:\s*"([^"]+)"/);
  if (catNameMatch) categoryName = decodeJsonString(catNameMatch[1]);

  let categoryId: string | undefined;
  const catIdMatch = html.match(/"leafCategoryId"\s*:\s*"?(\d+)"?/);
  if (catIdMatch) categoryId = catIdMatch[1];

  // ---- product attributes (featureAttributes JSON array + packing weight + dimensions) ----
  const featureAttributes = parseFeatureAttributes(html);
  const productPackagingDimensions = parseProductPackagingDimensions(featureAttributes);
  const packingDimensionsRows = parsePackingDimensionsRows(html);

  // Prefer the column-aligned weight from the full packing dimensions table.
  // `parseProductWeightG`'s regex grabs the first <td> with a digit after the
  // 重量(g) header — but 重量(g) is usually the LAST column header on a
  // multi-column packing table, so the first numeric <td> after it is the
  // LENGTH cell of the first data row, not the weight cell. That bug produced
  // wrong shipping weights like 0.04 lb (~18 g). The table parser uses proper
  // column alignment.
  let productWeightG: number | undefined;
  const tableWeightG = packingDimensionsRows
    .map((r) => r.weightG)
    .find((w): w is number => w !== null && w > 0);
  if (tableWeightG !== undefined) {
    productWeightG = tableWeightG;
  } else {
    productWeightG = parseProductWeightG(html);
  }

  return {
    offerId,
    title: title.trim(),
    descriptionUrl,
    images,
    price: { min: priceMin, max: priceMax, currency: "CNY" },
    supplier,
    categoryName: categoryName ?? null,
    categoryId,
    featureAttributes,
    productWeightG,
    productPackagingDimensions,
    packingDimensionsRows,
  };
}
