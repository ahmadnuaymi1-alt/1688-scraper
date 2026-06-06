/**
 * Deterministic test of fetchViaBrightData retry behavior — mocks global fetch.
 * Verifies: (1) transient 502 is retried then succeeds; (2) non-retryable 404
 * fails fast with a single attempt.
 */
process.env.BRIGHT_DATA_TOKEN = "test-token";
process.env.BRIGHT_DATA_ZONE = "test-zone";

const BIG_BODY = "x".repeat(60_000); // > MIN_BODY_BYTES (50k)

function mockResponse(status: number, body: string): Response {
  return {
    status,
    text: async () => body,
  } as unknown as Response;
}

async function main() {
  const { fetchViaBrightData, BrightDataError } = await import(
    "../src/lib/scraper/bright-data-client"
  );
  const realFetch = globalThis.fetch;
  let pass = 0;
  let fail = 0;

  // --- Test 1: 502, 502, then 200 + big body → should succeed after retries.
  {
    let calls = 0;
    const seq = [
      mockResponse(502, "<html>502 Bad Gateway</html>"),
      mockResponse(502, "<html>502 Bad Gateway</html>"),
      mockResponse(200, BIG_BODY),
    ];
    globalThis.fetch = (async () => {
      const r = seq[Math.min(calls, seq.length - 1)];
      calls++;
      return r;
    }) as typeof fetch;
    const t0 = Date.now();
    try {
      const html = await fetchViaBrightData("https://detail.1688.com/offer/1.html");
      const ok = html.length === BIG_BODY.length && calls === 3;
      console.log(
        `Test 1 (502→502→200): ${ok ? "PASS" : "FAIL"} — calls=${calls} bytes=${html.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
      );
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`Test 1: FAIL — threw ${e instanceof Error ? e.message : e}`);
      fail++;
    }
  }

  // --- Test 2: 404 → should fail fast, single attempt, no retry.
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return mockResponse(404, "<html>not found</html>");
    }) as typeof fetch;
    try {
      await fetchViaBrightData("https://detail.1688.com/offer/2.html");
      console.log(`Test 2 (404): FAIL — should have thrown (calls=${calls})`);
      fail++;
    } catch (e) {
      const isBd = e instanceof BrightDataError && (e as { status?: number }).status === 404;
      const ok = isBd && calls === 1;
      console.log(`Test 2 (404 fail-fast): ${ok ? "PASS" : "FAIL"} — calls=${calls} status=${(e as { status?: number }).status}`);
      ok ? pass++ : fail++;
    }
  }

  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
