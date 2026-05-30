/**
 * Batch driver for 5/24/2026 scrape:
 *   1. Bulk-generate heroes for all 13 products via _hf-cli-bulk-heroes.ts.
 *   2. After heroes complete, run _lifestyle-image-creator.ts for each
 *      product sequentially (each call internally drives 6 scenes in parallel
 *      via Higgsfield's web UI). --headed always on.
 *
 * Times each phase and the total. Output goes to stdout; stderr from child
 * processes is also relayed so we can see browser progress live.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const IDS = [
  "cmpjstemm004fw2ggzp3ur3wo",
  "cmpjstlof005zw2ggy9gucyhh",
  "cmpjstyid007tw2ggulv0g8b3",
  "cmpjsu8vd009vw2gg63xpg2fv",
  "cmpjsug3l00cpw2gg1r25v59u",
  "cmpjsv24600f9w2ggmzvuyfx3",
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsvclt00j5w2ggw4yzlyw5",
  "cmpjswf6e00njw2ggf8fceqtd",
  "cmpjswsmv00rfw2ggb4z2n7tb",
  "cmpjsx9f700thw2gg2r2kiukv",
  "cmpjsxx7n010pw2ggqsx242gf",
  "cmpjsymhx015fw2gg6zf5kp9n",
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
  const logPath = path.resolve("may24-batch-timing.log");
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + "\n");
  };

  log(`=== START batch for 13 products (5/24/2026) ===`);

  // ── Phase 1: bulk heroes ───────────────────────────────────────────────
  log(`Phase 1: bulk heroes for all 13 products via _hf-cli-bulk-heroes.ts`);
  const heroStart = Date.now();
  const heroCode = await runScript([
    "scripts/_hf-cli-bulk-heroes.ts",
    "--products",
    IDS.join(","),
  ]);
  const heroElapsed = Date.now() - heroStart;
  log(`Phase 1 done in ${fmtElapsed(heroElapsed)} (exit ${heroCode})`);
  if (heroCode !== 0) {
    log(`Hero phase failed — bailing.`);
    process.exit(1);
  }

  // ── Phase 2: lifestyles per product ─────────────────────────────────────
  log(`Phase 2: lifestyles for all 13 products (sequential, --headed)`);
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
  log(`Phase 2 done in ${fmtElapsed(lifestyleElapsed)}`);

  // ── Summary ────────────────────────────────────────────────────────────
  const totalElapsed = Date.now() - totalStart;
  log(`=== SUMMARY ===`);
  log(`Heroes (bulk, 13 products):  ${fmtElapsed(heroElapsed)}`);
  log(`Lifestyles (sum of 13 runs): ${fmtElapsed(lifestyleElapsed)}`);
  for (const t of lifestyleTimings) {
    log(`  ${t.id}: ${fmtElapsed(t.ms)} (exit ${t.code})`);
  }
  log(`TOTAL:                       ${fmtElapsed(totalElapsed)}`);
})();
