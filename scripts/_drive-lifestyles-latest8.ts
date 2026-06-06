/**
 * Drive lifestyle + closeup generation for the latest 8 products in parallel.
 *
 * Per product the target is: >= 6 lifestyle ProductImage rows AND >= 1 closeup
 * ProductImage row. Each invocation of _lifestyle-image-creator.ts attempts 6
 * lifestyles + 1 closeup. If Higgsfield 502s drop the count below target, we
 * retry that product (up to MAX_RETRIES). Retries WILL overshoot — the
 * lifestyle script has no partial-fill mode — but that's preferable to leaving
 * a product short.
 *
 * Strategy:
 *   1. Count current lifestyle + closeup per product. Skip if already at target.
 *   2. Fire all under-target products in parallel via Promise.all (each spawns
 *      a child npx tsx _lifestyle-image-creator.ts <pid>).
 *   3. Re-count. If still short, retry. Loop up to MAX_RETRIES.
 *   4. Final report.
 *
 * Per the user's "1 hero per unique variant image" / parallelism preferences,
 * fanout is via Promise.all — no sequential await-in-a-loop across products.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

// Latest 8 by createdAt — the two products previously thought to be the latest
// (cmpvdvrbu00atw2hk09s9sds6 and cmpvdv330000jtzr0x291djgp) were deleted from
// the DB between sessions, so we shift to include the two next-oldest scrapes.
const PRODUCT_IDS = [
  "cmpvdwok500frw2hk9nmld4k0",
  "cmpvdvyra00dbw2hktxto64m0",
  "cmpvdv27r008sw2hk94xcdomh",
  "cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes",
  "cmpvdueu50047w2hktmugaati",
  "cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];

const TARGET_LIFESTYLE = 6;
const TARGET_CLOSEUP = 1;
const MAX_RETRIES = 3;
const LOGS_DIR = path.join("scripts", "_drive-lifestyles-latest8-logs");

const prisma = new PrismaClient();

interface Counts { lifestyle: number; closeup: number; }

async function countFor(pid: string): Promise<Counts> {
  // Supabase PgBouncer occasionally drops connections under load — retry up
  // to 4 times with exponential backoff before giving up. Returning -1 on
  // total failure would mis-classify the product as needing more work.
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const [lifestyle, closeup] = await Promise.all([
        prisma.productImage.count({ where: { productId: pid, imageType: "lifestyle" } }),
        prisma.productImage.count({ where: { productId: pid, imageType: "closeup" } }),
      ]);
      return { lifestyle, closeup };
    } catch (e) {
      lastErr = e;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

function isComplete(c: Counts): boolean {
  return c.lifestyle >= TARGET_LIFESTYLE && c.closeup >= TARGET_CLOSEUP;
}

async function runLifestyleOnce(pid: string, attempt: number): Promise<number> {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `${pid}_attempt${attempt}.log`);
  const out = fs.openSync(logFile, "w");
  return new Promise((resolve) => {
    const proc = spawn(
      "npx",
      ["tsx", "scripts/_lifestyle-image-creator.ts", pid],
      { stdio: ["ignore", out, out], shell: true },
    );
    proc.on("close", (code) => {
      fs.closeSync(out);
      resolve(code ?? -1);
    });
    proc.on("error", () => {
      fs.closeSync(out);
      resolve(-1);
    });
  });
}

async function processOne(pid: string): Promise<{ pid: string; final: Counts; attempts: number; status: "OK" | "INCOMPLETE" }> {
  const initial = await countFor(pid);
  console.log(`[start] ${pid}  current=${initial.lifestyle}L+${initial.closeup}C`);
  if (isComplete(initial)) {
    console.log(`[skip ] ${pid}  already at target`);
    return { pid, final: initial, attempts: 0, status: "OK" };
  }
  // If lifestyle is already at target but closeup is missing, do NOT re-run
  // the lifestyle script — it would just add 6 more wasted lifestyles. Defer
  // to the closeup sweep step at the end of the parent run.
  if (initial.lifestyle >= TARGET_LIFESTYLE && initial.closeup < TARGET_CLOSEUP) {
    console.log(`[defer] ${pid}  lifestyle at target but closeup missing — sweep will handle`);
    return { pid, final: initial, attempts: 0, status: "INCOMPLETE" };
  }
  let last = initial;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    const code = await runLifestyleOnce(pid, attempt);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    let after: Counts;
    try {
      after = await countFor(pid);
    } catch (e) {
      console.log(`[run${attempt}] ${pid}  exit=${code}  elapsed=${elapsed}s  COUNT FAILED: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    console.log(`[run${attempt}] ${pid}  exit=${code}  elapsed=${elapsed}s  now=${after.lifestyle}L+${after.closeup}C  (was ${last.lifestyle}L+${last.closeup}C)`);
    last = after;
    if (isComplete(after)) {
      return { pid, final: after, attempts: attempt, status: "OK" };
    }
    // If we hit lifestyle but not closeup, stop running lifestyle (it'd just
    // overshoot). Sweep will fix closeup.
    if (after.lifestyle >= TARGET_LIFESTYLE) {
      console.log(`[defer] ${pid}  lifestyle at target after run${attempt} — defer closeup to sweep`);
      return { pid, final: after, attempts: attempt, status: "INCOMPLETE" };
    }
  }
  console.log(`[fail ] ${pid}  exhausted ${MAX_RETRIES} retries — still ${last.lifestyle}L+${last.closeup}C`);
  return { pid, final: last, attempts: MAX_RETRIES, status: "INCOMPLETE" };
}

(async () => {
  const t0 = Date.now();
  console.log(`Driving lifestyle+closeup for ${PRODUCT_IDS.length} products in parallel.`);
  console.log(`Target: ${TARGET_LIFESTYLE} lifestyle + ${TARGET_CLOSEUP} closeup per product. Max ${MAX_RETRIES} retries each.`);
  console.log(`Per-product child logs: ${LOGS_DIR}/<pid>_attempt<N>.log\n`);

  const results = await Promise.all(PRODUCT_IDS.map(processOne));

  // Closeup sweep — products that hit the lifestyle bar but lost their closeup
  // due to DB connection blips during the child's auto-closeup step. Drive
  // _hf-cli-bulk-closeups.ts in one batched invocation per product (max 3
  // retries each via the same processOne path? No — simpler: one batch call).
  const needsCloseup = results.filter((r) => r.final.lifestyle >= TARGET_LIFESTYLE && r.final.closeup < TARGET_CLOSEUP);
  if (needsCloseup.length > 0) {
    console.log(`\n========== CLOSEUP SWEEP ==========`);
    console.log(`${needsCloseup.length} product(s) need closeup-only retry: ${needsCloseup.map((r) => r.pid).join(", ")}`);
    const idsArg = needsCloseup.map((r) => r.pid).join(",");
    const code = await new Promise<number>((resolve) => {
      const proc = spawn(
        "npx",
        ["tsx", "scripts/_hf-cli-bulk-closeups.ts", "--products", idsArg, "--count", "1"],
        { stdio: "inherit", shell: true },
      );
      proc.on("close", (c) => resolve(c ?? -1));
      proc.on("error", () => resolve(-1));
    });
    console.log(`Closeup sweep exit ${code}.`);
    // Re-poll counts for the swept products.
    for (const r of needsCloseup) {
      try { r.final = await countFor(r.pid); r.status = isComplete(r.final) ? "OK" : "INCOMPLETE"; } catch {}
    }
  }

  const ok = results.filter((r) => r.status === "OK").length;
  const incomplete = results.filter((r) => r.status === "INCOMPLETE");
  const totalAttempts = results.reduce((acc, r) => acc + r.attempts, 0);
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(`\n========== FINAL ==========`);
  console.log(`Total wall: ${totalElapsed}s  (${(parseInt(totalElapsed, 10) / 60).toFixed(1)} min)`);
  console.log(`Products at target: ${ok}/${PRODUCT_IDS.length}`);
  console.log(`Total lifestyle invocations: ${totalAttempts}`);
  for (const r of results) {
    const flag = r.status === "OK" ? "✓" : "✗";
    console.log(`  ${flag} ${r.pid}  ${r.final.lifestyle}L+${r.final.closeup}C  (${r.attempts} attempt(s))`);
  }
  if (incomplete.length > 0) {
    console.log(`\n${incomplete.length} product(s) still short after ${MAX_RETRIES} retries — manual follow-up needed.`);
  }
  await prisma.$disconnect();
})();
