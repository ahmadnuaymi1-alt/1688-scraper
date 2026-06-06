/**
 * Drive lifestyle + closeup for 9 specific products in parallel, with retry,
 * and report wall-time. Heroes are NOT touched here — assumed done already.
 *
 * Per-product target: >= 6 lifestyles + >= 1 closeup. Each product gets up to
 * 3 attempts. After lifestyle phase, a single _hf-cli-bulk-closeups.ts batch
 * picks up any product that landed lifestyle but missed closeup.
 *
 * Per-product child logs at scripts/_drive-lifestyles-only-9-logs/.
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

const PRODUCT_IDS = [
  "cmpwtf8ds00inw29ghs56kiq8",
  "cmpwsr41400dtw28cxispu8c8",
  "cmpwtdpb5005uw29gk3uft7k8",
  "cmpwsp4ar007fw28chis8tnk8",
  "cmpwsph9v00adw28csba3rrwy",
  "cmpwtev6z00gbw29gpe4rxq0r",
  "cmpwsowix005rw28cx6mwp3t3",
  "cmpwsol0y002rw28cii3g4ja6",
  "cmpwte53l00bhw29gm0ue8mvq",
];

const TARGET_LIFESTYLE = 6;
const TARGET_CLOSEUP = 1;
const MAX_RETRIES = 3;
const PER_SCRIPT_CONCURRENCY = "3";
const LOGS_DIR = path.join("scripts", "_drive-lifestyles-only-9-logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const prisma = new PrismaClient();

interface Counts { lifestyle: number; closeup: number; }

async function dbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < 3) await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

async function countFor(pid: string): Promise<Counts> {
  return dbRetry(async () => {
    const [lifestyle, closeup] = await Promise.all([
      prisma.productImage.count({ where: { productId: pid, imageType: "lifestyle" } }),
      prisma.productImage.count({ where: { productId: pid, imageType: "closeup" } }),
    ]);
    return { lifestyle, closeup };
  });
}

function fmt(ms: number): string { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(0)}s`; }

function spawnAndLog(cmd: string, args: string[], logFile: string): Promise<number> {
  const out = fs.openSync(logFile, "w");
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", out, out], shell: true });
    proc.on("close", (code) => { fs.closeSync(out); resolve(code ?? -1); });
    proc.on("error", () => { fs.closeSync(out); resolve(-1); });
  });
}

interface Result { pid: string; final: Counts; attempts: number; status: "OK" | "INCOMPLETE"; }

async function processOne(pid: string): Promise<Result> {
  const initial = await countFor(pid);
  console.log(`[start] ${pid}  current=${initial.lifestyle}L+${initial.closeup}C`);
  if (initial.lifestyle >= TARGET_LIFESTYLE && initial.closeup >= TARGET_CLOSEUP) {
    console.log(`[skip ] ${pid}  already at target`);
    return { pid, final: initial, attempts: 0, status: "OK" };
  }
  if (initial.lifestyle >= TARGET_LIFESTYLE && initial.closeup < TARGET_CLOSEUP) {
    console.log(`[defer] ${pid}  lifestyle ok, closeup missing — sweep will handle`);
    return { pid, final: initial, attempts: 0, status: "INCOMPLETE" };
  }
  let last = initial;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    const logFile = path.join(LOGS_DIR, `${pid}_attempt${attempt}.log`);
    const code = await spawnAndLog("npx", ["tsx", "scripts/_lifestyle-image-creator.ts", pid, "--concurrency", PER_SCRIPT_CONCURRENCY], logFile);
    let after: Counts;
    try { after = await countFor(pid); }
    catch (e) { console.log(`[run${attempt}] ${pid}  exit=${code}  elapsed=${fmt(Date.now() - t0)}  COUNT FAILED: ${e instanceof Error ? e.message : e}`); continue; }
    console.log(`[run${attempt}] ${pid}  exit=${code}  elapsed=${fmt(Date.now() - t0)}  now=${after.lifestyle}L+${after.closeup}C  (was ${last.lifestyle}L+${last.closeup}C)`);
    last = after;
    if (after.lifestyle >= TARGET_LIFESTYLE && after.closeup >= TARGET_CLOSEUP) return { pid, final: after, attempts: attempt, status: "OK" };
    if (after.lifestyle >= TARGET_LIFESTYLE) {
      console.log(`[defer] ${pid}  lifestyle ok after run${attempt} — closeup deferred to sweep`);
      return { pid, final: after, attempts: attempt, status: "INCOMPLETE" };
    }
  }
  console.log(`[fail ] ${pid}  exhausted ${MAX_RETRIES} retries — still ${last.lifestyle}L+${last.closeup}C`);
  return { pid, final: last, attempts: MAX_RETRIES, status: "INCOMPLETE" };
}

(async () => {
  const tStart = Date.now();
  console.log(`Driving lifestyle + closeup for ${PRODUCT_IDS.length} products in parallel.`);
  console.log(`Targets: ${TARGET_LIFESTYLE} lifestyle + ${TARGET_CLOSEUP} closeup per product.  Per-script concurrency: ${PER_SCRIPT_CONCURRENCY}.`);
  const results = await Promise.all(PRODUCT_IDS.map(processOne));

  const needsCloseup = results.filter((r) => r.final.lifestyle >= TARGET_LIFESTYLE && r.final.closeup < TARGET_CLOSEUP);
  if (needsCloseup.length > 0) {
    console.log(`\n========== CLOSEUP SWEEP ==========`);
    console.log(`${needsCloseup.length} product(s) need closeup-only retry: ${needsCloseup.map((r) => r.pid).join(", ")}`);
    const csv = needsCloseup.map((r) => r.pid).join(",");
    const logFile = path.join(LOGS_DIR, `closeup_sweep.log`);
    const code = await spawnAndLog("npx", ["tsx", "scripts/_hf-cli-bulk-closeups.ts", "--products", csv, "--count", "1"], logFile);
    console.log(`Closeup sweep exit ${code}.`);
    for (const r of needsCloseup) {
      try { r.final = await countFor(r.pid); r.status = (r.final.lifestyle >= TARGET_LIFESTYLE && r.final.closeup >= TARGET_CLOSEUP) ? "OK" : "INCOMPLETE"; } catch {}
    }
  }

  const totalElapsed = Math.round((Date.now() - tStart) / 1000);
  console.log(`\n========== FINAL ==========`);
  console.log(`Total wall: ${totalElapsed}s = ${Math.floor(totalElapsed / 60)}m ${totalElapsed % 60}s`);
  let ok = 0;
  for (const r of results) {
    const isOk = r.status === "OK";
    if (isOk) ok++;
    const flag = isOk ? "✓" : "✗";
    console.log(`  ${flag} ${r.pid}  ${r.final.lifestyle}L+${r.final.closeup}C  (${r.attempts} attempt(s))`);
  }
  console.log(`\n${ok}/${PRODUCT_IDS.length} at full target.`);
  await prisma.$disconnect();
})();
