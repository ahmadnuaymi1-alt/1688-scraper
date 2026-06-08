/**
 * Shopify Admin token exchange — OAuth client_credentials grant.
 *
 * Custom Apps installed via Shopify Admin → Settings → Apps → Develop apps
 * expose `client_id` (API key) and `client_secret` (API secret key, often
 * prefixed `shpss_`). Exchange them for a usable Admin API access token via
 * the `client_credentials` OAuth grant.
 *
 * The returned token is a `shpat_*` or `shpca_*` value passed in
 * `X-Shopify-Access-Token` on Admin GraphQL/REST calls. `shpca_*` tokens
 * expire after 24h, so callers that persist the token should also persist
 * `client_id` + `client_secret` and re-run this on 401 to mint a fresh one.
 */
export async function exchangeForAccessToken(
  storeDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const url = `https://${storeDomain.replace(/^https?:\/\//, "")}/admin/oauth/access_token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Shopify client_credentials grant failed (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }
  let parsed: { access_token?: unknown };
  try {
    parsed = JSON.parse(body) as { access_token?: unknown };
  } catch {
    throw new Error(`Shopify returned non-JSON response: ${body.slice(0, 300)}`);
  }
  const token = typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!token) {
    throw new Error(`Shopify response missing access_token field: ${body.slice(0, 300)}`);
  }
  return token;
}
