/**
 * 5/28 fan-light batch driver:
 *   Phase A — bulk heroes for all 9 products via _hf-cli-bulk-heroes.ts
 *   Phase B — lifestyles for each product sequentially (single-unit only,
 *             no --multi-unit flags per project rule)
 *   Phase C — POST /api/products/{id}/reapply-rules with categories
 *             ["title","description","image"] for each product
 *
 * Times each phase and prints a final summary. The dev server must be
 * running on http://localhost:3000 for Phase C — it shells out to fetch().
 * Phase C needs an auth cookie; if dev server requires auth, this script
 * grabs the session by POSTing to /api/auth/login first using credentials
 * from .env.local (DEV_EMAIL + DEV_PASSWORD) — falls back to hardcoded
 * test creds for the local dev user.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const IDS = [
  "cmppqhbny0086w2vsw926vypg",
  "cmppqhueh00amw2vsdewbgxhs",
  "cmppqiiol00f1w2vsgq039299",
  "cmppqgin7004cw2vs04697sgd",
  "cmppqhqaa009mw2vslvgoavnn",
  "cmppv6kdl00rjw2vsnhsp6sqn",
  "cmppv892200t9w2vsh5vgmgmg",
  "cmppqgw3z005mw2vsplzfocnl",
  "cmppqg7nw002hw2vsohivuebc",
];

function fmtElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function runScript(scriptArgs: string[]): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", ...scriptArgs], {
      stdio: "inherit",
      shell: true,
    });
    proc.on("close", (code) => resolve(code ?? -1));
    proc.on("error", (err) => {
      console.error(`[spawn error] ${err.message}`);
      resolve(-1);
    });
  });
}

(async () => {
  const totalStart = Date.now();
  const logPath = path.resolve("may28-batch.log");
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + "\n");
  };

  log(`=== START 5/28 batch for ${IDS.length} products ===`);

  // ── Phase A: bulk heroes ───────────────────────────────────────────────
  log(`Phase A: bulk heroes via _hf-cli-bulk-heroes.ts`);
  const heroStart = Date.now();
  const heroCode = await runScript([
    "scripts/_hf-cli-bulk-heroes.ts",
    "--products",
    IDS.join(","),
  ]);
  const heroElapsed = Date.now() - heroStart;
  log(`Phase A done in ${fmtElapsed(heroElapsed)} (exit ${heroCode})`);
  if (heroCode !== 0) {
    log(`Hero phase failed — bailing.`);
    process.exit(1);
  }

  // ── Phase B: lifestyles per product (single-unit, sequential) ─────────
  log(`Phase B: lifestyles (single-unit) for ${IDS.length} products`);
  const lifestyleTimings: { id: string; ms: number; code: number }[] = [];
  const lifestylePhaseStart = Date.now();
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    log(`  [${i + 1}/${IDS.length}] ${id}`);
    const t0 = Date.now();
    const code = await runScript([
      "scripts/_lifestyle-image-creator.ts",
      id,
      "--headed",
    ]);
    const ms = Date.now() - t0;
    lifestyleTimings.push({ id, ms, code });
    log(`  [${i + 1}/${IDS.length}] ${id} → ${fmtElapsed(ms)} (exit ${code})`);
  }
  const lifestyleElapsed = Date.now() - lifestylePhaseStart;
  log(`Phase B done in ${fmtElapsed(lifestyleElapsed)}`);

  // ── Phase C: reapply title + description + image rules ────────────────
  log(`Phase C: reapply title + description + image rules`);
  const rulesStart = Date.now();
  const ruleTimings: { id: string; ms: number; ok: boolean; err?: string }[] = [];

  // Get a session cookie. The dev login route accepts { email, password }
  // and sets the scraper_1688_session cookie on success.
  const email = process.env.DEV_EMAIL || "ahmadnuaymi1@gmail.com";
  const password = process.env.DEV_PASSWORD || "Malak2010";
  log(`  logging in as ${email} to grab session cookie`);
  let cookieHeader = "";
  try {
    const loginRes = await fetch("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const rawCookies = loginRes.headers.get("set-cookie") || "";
    // crude: take just the scraper_1688_session=<value>; bit
    const m = rawCookies.match(/scraper_1688_session=[^;]+/);
    if (!m) throw new Error(`no session cookie in login response: ${rawCookies.slice(0, 200)}`);
    cookieHeader = m[0];
    log(`  login OK`);
  } catch (err) {
    log(`  LOGIN FAILED: ${err instanceof Error ? err.message : err}`);
    log(`  Skipping Phase C — rules can be reapplied manually from /review/<id>.`);
    process.exit(1);
  }

  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const t0 = Date.now();
    log(`  [${i + 1}/${IDS.length}] ${id} reapply rules`);
    try {
      const res = await fetch(
        `http://localhost:3000/api/products/${id}/reapply-rules`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: cookieHeader,
          },
          body: JSON.stringify({
            categories: ["title", "description", "image"],
          }),
        },
      );
      const ms = Date.now() - t0;
      const text = await res.text();
      if (!res.ok) {
        ruleTimings.push({ id, ms, ok: false, err: `${res.status} ${text.slice(0, 200)}` });
        log(`    FAIL ${res.status} in ${fmtElapsed(ms)}: ${text.slice(0, 200)}`);
      } else {
        ruleTimings.push({ id, ms, ok: true });
        log(`    OK in ${fmtElapsed(ms)}`);
      }
    } catch (err) {
      const ms = Date.now() - t0;
      ruleTimings.push({
        id,
        ms,
        ok: false,
        err: err instanceof Error ? err.message : String(err),
      });
      log(`    THROW in ${fmtElapsed(ms)}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const rulesElapsed = Date.now() - rulesStart;
  log(`Phase C done in ${fmtElapsed(rulesElapsed)}`);

  // ── Summary ────────────────────────────────────────────────────────────
  const totalElapsed = Date.now() - totalStart;
  log(`\n=== SUMMARY ===`);
  log(`Phase A (heroes):     ${fmtElapsed(heroElapsed)}`);
  log(`Phase B (lifestyles): ${fmtElapsed(lifestyleElapsed)}`);
  for (const t of lifestyleTimings) {
    log(`  ${t.id}: ${fmtElapsed(t.ms)} (exit ${t.code})`);
  }
  log(`Phase C (rules):      ${fmtElapsed(rulesElapsed)}`);
  for (const t of ruleTimings) {
    log(`  ${t.id}: ${fmtElapsed(t.ms)} ${t.ok ? "OK" : `FAIL — ${t.err?.slice(0, 100)}`}`);
  }
  log(`TOTAL:                ${fmtElapsed(totalElapsed)}`);
})();
