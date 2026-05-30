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
 *   - HTTP 200 with a suspiciously short body (< MIN_BODY_BYTES) — BD has been
 *     observed to occasionally return 200 + 0 bytes on otherwise-good URLs.
 *
 * Does NOT retry on HTTP error status (400/4xx/5xx response from BD itself).
 * Throws `BrightDataError` on the final failure.
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
  let lastShortBodyLength: number | null = null;

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
      throw new BrightDataError(
        `Bright Data Web Unlocker returned HTTP ${res.status}: ${body.slice(0, 200)}`,
        res.status,
      );
    }

    const body = await res.text();
    if (body.length < MIN_BODY_BYTES) {
      lastShortBodyLength = body.length;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new BrightDataError(
        `Bright Data returned suspiciously short body (${body.length} bytes) after ${MAX_ATTEMPTS} attempts — usually a transient BD flake, try again shortly.`,
        200,
      );
    }

    return body;
  }

  if (lastShortBodyLength !== null) {
    throw new BrightDataError(
      `Bright Data returned suspiciously short body (${lastShortBodyLength} bytes) after ${MAX_ATTEMPTS} attempts`,
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
