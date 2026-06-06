/**
 * Bright Data Web Unlocker client (thin wrapper).
 *
 * Used to fetch the fully rendered HTML of a 1688 detail page through
 * Bright Data's residential-proxy + anti-bot unlocker. Returns the raw HTML
 * string on success; throws on any non-200 response or transport error.
 *
 * Required env vars:
 *   BRIGHT_DATA_TOKEN — bearer token for api.brightdata.com
 *   BRIGHT_DATA_ZONE  — Web Unlocker zone name
 */

const BD_ENDPOINT = "https://api.brightdata.com/request";
const FETCH_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 5;
/**
 * Backoff in ms between attempts. Bright Data 0-byte/short-body responses
 * are usually a stale residential-proxy session that takes 10–30s to rotate;
 * a flat 2s delay puts every retry on the same dead session. Exponential
 * pattern is 2s → 5s → 10s → 20s for the 4 inter-attempt gaps (sums to ~37s),
 * which gives the BD-side session pool time to recycle.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

/**
 * HTTP statuses that mean "Bright Data / the upstream gateway flaked, try
 * again" rather than "this request is permanently bad". 502/503/504 are gateway
 * errors thrown when a residential-proxy session dies mid-flight (we've seen
 * `502 Bad Gateway` HTML pages returned intermittently on URLs that fetch fine
 * seconds later); 408/425/429 are timeout / too-early / rate-limit. Everything
 * else (400/403/404 etc.) is a real problem retrying won't fix.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Minimum body size to consider a response "real". Successful 1688 detail-page
 * HTML is 500-650 KB; an empty body or a 1-2 KB body is Bright Data flaking
 * out (we've observed HTTP 200 + 0 bytes intermittently). Anything below this
 * threshold gets retried as if it were a transport error.
 */
const MIN_BODY_BYTES = 50_000;

export class BrightDataError extends Error {
  public readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "BrightDataError";
    this.status = status;
  }
}

export interface FetchViaBrightDataOptions {
  format?: "raw" | "json";
}

/**
 * POST a fetch request through Bright Data Web Unlocker and return the body.
 *
 * Retries up to `MAX_ATTEMPTS` times on:
 *   - transport-level failures (timeout / network)
 *   - transient HTTP statuses (gateway 5xx / 429 rate-limit — see
 *     RETRYABLE_STATUSES), which BD throws when a proxy session dies mid-flight
 *   - HTTP 200 with a suspiciously short body (< MIN_BODY_BYTES) — BD has been
 *     observed to occasionally return 200 + 0 bytes on otherwise-good URLs.
 *
 * Does NOT retry on non-retryable HTTP error status (400/403/404 etc. from BD
 * itself) — those won't resolve on retry. Throws `BrightDataError` on the final
 * failure.
 */
export async function fetchViaBrightData(
  url: string,
  opts?: FetchViaBrightDataOptions,
): Promise<string> {
  const token = process.env.BRIGHT_DATA_TOKEN;
  const zone = process.env.BRIGHT_DATA_ZONE;
  if (!token || !zone) {
    throw new BrightDataError(
      "BRIGHT_DATA_TOKEN or BRIGHT_DATA_ZONE not configured in environment.",
    );
  }

  const format = opts?.format ?? "raw";
  let lastTransportError: unknown = null;
  // Track BOTH the length and a small preview of the last short body. The
  // preview is what tells us in retrospect whether BD returned literally
  // nothing, a Cloudflare challenge, a captcha page, or some other
  // characteristic shape — and including it in the final error message
  // makes future incidents diagnosable from the JobLog alone.
  let lastShortBody: { length: number; preview: string } | null = null;
  let lastRetryableStatus: { status: number; body: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(BD_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ zone, url, format }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastTransportError = err;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new BrightDataError(
        `Bright Data fetch error after ${MAX_ATTEMPTS} attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (res.status !== 200) {
      const body = await res.text().catch(() => "");
      // Transient gateway / rate-limit errors: back off and retry. A stale BD
      // residential session takes 10–30s to recycle, so the same backoff used
      // for short-body flakes applies here.
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        lastRetryableStatus = { status: res.status, body };
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new BrightDataError(
        `Bright Data Web Unlocker returned HTTP ${res.status}` +
          (RETRYABLE_STATUSES.has(res.status) ? ` after ${MAX_ATTEMPTS} attempts` : "") +
          `: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const body = await res.text();
    if (body.length < MIN_BODY_BYTES) {
      lastShortBody = { length: body.length, preview: body.slice(0, 200) };
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new BrightDataError(
        `Bright Data returned suspiciously short body (${body.length} bytes) after ${MAX_ATTEMPTS} attempts — usually a transient BD flake, try again shortly. Body preview: ${JSON.stringify(body.slice(0, 200))}`,
        200,
      );
    }

    return body;
  }

  // Defensive fallback — the loop above always returns or throws on its final
  // attempt, so this is only reached if MAX_ATTEMPTS is misconfigured to 0.
  if (lastRetryableStatus !== null) {
    throw new BrightDataError(
      `Bright Data Web Unlocker returned HTTP ${lastRetryableStatus.status} after ${MAX_ATTEMPTS} attempts: ${lastRetryableStatus.body.slice(0, 200)}`,
      lastRetryableStatus.status,
    );
  }
  if (lastShortBody !== null) {
    throw new BrightDataError(
      `Bright Data returned suspiciously short body (${lastShortBody.length} bytes) after ${MAX_ATTEMPTS} attempts. Body preview: ${JSON.stringify(lastShortBody.preview)}`,
      200,
    );
  }
  throw new BrightDataError(
    `Bright Data fetch error after ${MAX_ATTEMPTS} attempts: ${lastTransportError instanceof Error ? lastTransportError.message : String(lastTransportError)}`,
  );
}

/** True iff Bright Data env vars are configured. */
export function isBrightDataConfigured(): boolean {
  return !!(process.env.BRIGHT_DATA_TOKEN && process.env.BRIGHT_DATA_ZONE);
}

/**
 * Classify an error thrown during Phase 1 of a scrape as transient (worth
 * auto-retrying after a delay) vs permanent (the URL / supplier is genuinely
 * broken; retrying will produce the same error).
 *
 * Transient (returns true):
 *   - `BrightDataError` whose status is one of the retryable HTTP codes
 *     (408/425/429/500/502/503/504) — gateway flakes / rate limits.
 *   - `BrightDataError` with status=200 (the "suspiciously short body" case
 *     emitted at the end of the internal retry loop above).
 *   - `BrightDataError` with no status field (transport error after the
 *     internal retries exhausted).
 *   - Plain `Error` whose message matches the well-known network-transient
 *     patterns (timeout, ECONNRESET, ENOTFOUND, fetch failed, etc.).
 *
 * Permanent (returns false):
 *   - `BrightDataError` with a permanent HTTP status (400/403/404).
 *   - Plain `Error` from URL validation, page-state parsing, extractor
 *     failures, or anything else that doesn't match the transient patterns.
 *
 * Used by the job processor to decide between rescheduleScrapeJob() and
 * failScrapeJob(). Conservative bias: when in doubt, transient — the cost
 * of a wasted retry is a 10-minute delay; the cost of a missed retry is a
 * permanently dead job the user has to manually re-queue.
 */
const TRANSIENT_MESSAGE_RE = /timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed/i;

export function isTransientScrapeError(err: unknown): boolean {
  if (err instanceof BrightDataError) {
    if (err.status === undefined) return true;
    if (err.status === 200) return true;
    return RETRYABLE_STATUSES.has(err.status);
  }
  if (err instanceof Error) {
    return TRANSIENT_MESSAGE_RE.test(err.message);
  }
  return false;
}
