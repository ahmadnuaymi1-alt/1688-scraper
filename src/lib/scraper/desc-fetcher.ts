/**
 * Fetches the rich description content for a 1688 offer.
 *
 * 1688's main detail page (detail.1688.com) is captcha-locked, but the
 * description content lives on a separate, openly-accessible CDN:
 *
 *   https://itemcdn.tmall.com/1688offer/{contentId}
 *
 * The URL is referenced from the Apify response's `descriptionUrl` field
 * as a query parameter on an air.1688.com wrapper:
 *
 *   https://air.1688.com/pages/od/app-desc/...?url=https://itemcdn.tmall.com/1688offer/...&offerId=...
 *
 * The CDN endpoint returns a JSONP-style payload:
 *
 *   var offer_details={"content":"<HTML>", ...};
 *
 * We extract the inner URL, fetch it, parse the JSONP, and return the
 * description HTML plus its image URLs.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 15_000;

export interface DescriptionContent {
  /** Raw HTML extracted from the offer_details.content field. */
  html: string;
  /** All image URLs found in the description HTML (in document order). */
  imageUrls: string[];
}

/**
 * Extract the inner itemcdn URL from a 1688 air.1688.com wrapper URL.
 * Returns the original URL if no inner URL is detected.
 */
export function extractItemcdnUrl(descriptionUrl: string): string {
  try {
    const parsed = new URL(descriptionUrl);
    const inner = parsed.searchParams.get("url");
    if (inner && /itemcdn\.(tmall|alicdn)\.com/.test(inner)) return inner;
  } catch {
    // fall through
  }
  return descriptionUrl;
}

/**
 * Fetch and parse the description content for a 1688 offer.
 *
 * Returns null on any failure (best-effort — the main scrape can succeed
 * without description content; downstream pipeline will handle absence).
 */
export async function fetch1688Description(
  descriptionUrl: string | undefined,
): Promise<DescriptionContent | null> {
  if (!descriptionUrl) return null;

  const itemcdnUrl = extractItemcdnUrl(descriptionUrl);

  let body: string;
  try {
    const res = await fetch(itemcdnUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: "https://air.1688.com/",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    body = await res.text();
  } catch {
    return null;
  }

  // Match `var offer_details={...};` (JSONP-style).
  const match = body.match(/var\s+offer_details\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!match) return null;

  let parsed: { content?: string };
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const html = parsed.content;
  if (typeof html !== "string" || html.length < 20) return null;

  const imageUrls = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi))
    .map((m) => m[1])
    .filter((u) => u.startsWith("http") || u.startsWith("//"));

  return { html, imageUrls };
}
