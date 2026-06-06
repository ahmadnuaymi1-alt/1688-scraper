/**
 * Drive heroes + lifestyles + closeups for a list of products in parallel,
 * with retry-until-target semantics.
 *
 * Phases:
 *   1. Heroes — spawn _hf-cli-bulk-heroes.ts --products <csv>. Repeats until
 *      every product has hero count >= unique-variant-image count, OR a max
 *      of HERO_MAX_RUNS bulk runs is reached. Higgsfield 502s + the multi-
 *      account switch in _higgsfield-cli.ts handle credit exhaustion.
 *   2. Lifestyle+closeup — for each product, fire _lifestyle-image-creator.ts
 *      <pid>. Target per product: >= 6 lifestyles + >= 1 closeup. Each
 *      product retries up to LIFESTYLE_MAX_RETRIES. After lifestyles, fire
 *      a single _hf-cli-bulk-closeups.ts batch for any product short on
 *      closeup (covers Supabase blips that killed the auto-closeup).
 *
 * Usage:
 *   npx tsx scripts/_drive-heroes-and-lifestyles.ts --products id1,id2,...
 *
 * Outputs per-product progress to stdout + per-product child logs under
 * scripts/_drive-heroes-and-lifestyles-logs/.
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

function parseArgs(): { productIds: string[] } {
  const argv = process.argv.slice(2);
  let productIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--products") {
      productIds = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (productIds.length === 0) { console.error("Usage: --products id1,id2,..."); process.exit(1); }
  return { productIds };
}

const TARGET_LIFESTYLE = 6;
const TARGET_CLOSEUP = 1;
const LIFESTYLE_MAX_RETRIES = 3;
const HERO_MAX_RUNS = 3;
const LOGS_DIR = path.join("scripts", "_drive-heroes-and-lifestyles-logs");

const prisma = new PrismaClient();

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

interface Counts { hero: number; expectedHero: number; lifestyle: number; closeup: number; }

async function dbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < 3) await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw lastErr;
}

async function countFor(pid: string): Promise<Counts> {
  return dbRetry(async () => {
    const variants = await prisma.variant.findMany({
      where: { productId: pid, isHidden: false },
      select: { featuredImageId: true },
    });
    const featIds = variants.map((v) => v.featuredImageId).filter((x): x is string => !!x);
    const featImgs = featIds.length ? await prisma.productImage.findMany({ where: { id: { in: featIds } }, select: { storagePath: true } }) : [];
    const expectedHero = new Set(featImgs.map((i) => i.storagePath).filter(Boolean)).size;
    const [hero, lifestyle, closeup] = await Promise.all([
      prisma.productImage.count({ where: { productId: pid, imageType: "hero-flat" } }),
      prisma.productImage.count({ where: { productId: pid, imageType: "lifestyle" } }),
      prisma.productImage.count({ where: { productId: pid, imageType: "closeup" } }),
    ]);
    return { hero, expectedHero, lifestyle, closeup };
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

async function phaseHeroes(productIds: string[]): Promise<void> {
  console.log(`\n========== PHASE 1: HEROES ==========`);
  for (let run = 1; run <= HERO_MAX_RUNS; run++) {
    const before = await Promise.all(productIds.map((id) => countFor(id).then((c) => ({ id, c }))));
    const short = before.filter(({ c }) => c.hero < c.expectedHero);
    if (short.length === 0) {
      console.log(`All ${productIds.length} products at hero target. Phase 1 complete.`);
      return;
    }
    console.log(`Run ${run}/${HERO_MAX_RUNS} — ${short.length} product(s) short: ${short.map((s) => `${s.id}(${s.c.hero}/${s.c.expectedHero})`).join(", ")}`);
    const csv = short.map((s) => s.id).join(",");
    const logFile = path.join(LOGS_DIR, `heroes_run${run}.log`);
    const t0 = Date.now();
    const code = await spawnAndLog("npx", ["tsx", "scripts/_hf-cli-bulk-heroes.ts", "--products", csv, "--concurrency", "6"], logFile);
    console.log(`  exit=${code}  elapsed=${fmt(Date.now() - t0)}  log=${logFile}`);
  }
  const finalState = await Promise.all(productIds.map((id) => countFor(id).then((c) => ({ id, c }))));
  const stillShort = finalState.filter(({ c }) => c.hero < c.expectedHero);
  if (stillShort.length > 0) console.log(`⚠ ${stillShort.length} product(s) still short after ${HERO_MAX_RUNS} hero runs: ${stillShort.map((s) => `${s.id}(${s.c.hero}/${s.c.expectedHero})`).join(", ")}`);
}

interface LifeResult { pid: string; final: Counts; attempts: number; status: "OK" | "INCOMPLETE"; }

async function runLifestyleOnce(pid: string, attempt: number): Promise<number> {
  const logFile = path.join(LOGS_DIR, `${pid}_life_attempt${attempt}.log`);
  return spawnAndLog("npx", ["tsx", "scripts/_lifestyle-image-creator.ts", pid], logFile);
}

async function processLifestyleOne(pid: string): Promise<LifeResult> {
  const initial = await countFor(pid);
  console.log(`[life-start] ${pid}  current=${initial.lifestyle}L+${initial.closeup}C`);
  if (initial.lifestyle >= TARGET_LIFESTYLE && initial.closeup >= TARGET_CLOSEUP) {
    console.log(`[life-skip ] ${pid}  already at target`);
    return { pid, final: initial, attempts: 0, status: "OK" };
  }
  if (initial.lifestyle >= TARGET_LIFESTYLE && initial.closeup < TARGET_CLOSEUP) {
    console.log(`[life-defer] ${pid}  lifestyle ok, closeup missing — sweep will handle`);
    return { pid, final: initial, attempts: 0, status: "INCOMPLETE" };
  }
  let last = initial;
  for (let attempt = 1; attempt <= LIFESTYLE_MAX_RETRIES; attempt++) {
    const t0 = Date.now();
    const code = await runLifestyleOnce(pid, attempt);
    let after: Counts;
    try { after = await countFor(pid); }
    catch (e) { console.log(`[life-run${attempt}] ${pid}  exit=${code}  elapsed=${fmt(Date.now() - t0)}  COUNT FAILED: ${e instanceof Error ? e.message : e}`); continue; }
    console.log(`[life-run${attempt}] ${pid}  exit=${code}  elapsed=${fmt(Date.now() - t0)}  now=${after.lifestyle}L+${after.closeup}C  (was ${last.lifestyle}L+${last.closeup}C)`);
    last = after;
    if (after.lifestyle >= TARGET_LIFESTYLE && after.closeup >= TARGET_CLOSEUP) return { pid, final: after, attempts: attempt, status: "OK" };
    if (after.lifestyle >= TARGET_LIFESTYLE) {
      console.log(`[life-defer] ${pid}  lifestyle ok after run${attempt} — closeup deferred to sweep`);
      return { pid, final: after, attempts: attempt, status: "INCOMPLETE" };
    }
  }
  console.log(`[life-fail ] ${pid}  exhausted ${LIFESTYLE_MAX_RETRIES} retries — still ${last.lifestyle}L+${last.closeup}C`);
  return { pid, final: last, attempts: LIFESTYLE_MAX_RETRIES, status: "INCOMPLETE" };
}

async function phaseLifestyles(productIds: string[]): Promise<LifeResult[]> {
  console.log(`\n========== PHASE 2: LIFESTYLES + CLOSEUPS ==========`);
  const results = await Promise.all(productIds.map(processLifestyleOne));

  // Closeup sweep
  const needsCloseup = results.filter((r) => r.final.lifestyle >= TARGET_LIFESTYLE && r.final.closeup < TARGET_CLOSEUP);
  if (needsCloseup.length > 0) {
    console.log(`\n===== CLOSEUP SWEEP ===== ${needsCloseup.length} product(s)`);
    const csv = needsCloseup.map((r) => r.pid).join(",");
    const logFile = path.join(LOGS_DIR, `closeup_sweep.log`);
    const code = await spawnAndLog("npx", ["tsx", "scripts/_hf-cli-bulk-closeups.ts", "--products", csv, "--count", "1"], logFile);
    console.log(`  exit=${code}  log=${logFile}`);
    for (const r of needsCloseup) {
      try {
        r.final = await countFor(r.pid);
        r.status = r.final.lifestyle >= TARGET_LIFESTYLE && r.final.closeup >= TARGET_CLOSEUP ? "OK" : "INCOMPLETE";
      } catch {}
    }
  }
  return results;
}

(async () => {
  const { productIds } = parseArgs();
  console.log(`Driving heroes + lifestyles + closeups for ${productIds.length} products.`);
  console.log(`Targets: 1 hero per unique variant image; ${TARGET_LIFESTYLE} lifestyles + ${TARGET_CLOSEUP} closeup per product.`);
  console.log(`Per-product child logs: ${LOGS_DIR}/`);
  const tStart = Date.now();

  await phaseHeroes(productIds);
  const lifeResults = await phaseLifestyles(productIds);

  // Final state
  console.log(`\n========== FINAL ==========`);
  console.log(`Total wall: ${fmt(Date.now() - tStart)}`);
  const finals = await Promise.all(productIds.map((id) => countFor(id).then((c) => ({ id, c }))));
  let okAll = 0;
  for (const { id, c } of finals) {
    const heroOk = c.hero >= c.expectedHero;
    const lifeOk = c.lifestyle >= TARGET_LIFESTYLE;
    const cuOk = c.closeup >= TARGET_CLOSEUP;
    const all = heroOk && lifeOk && cuOk;
    if (all) okAll++;
    const flag = all ? "✓" : "✗";
    console.log(`  ${flag} ${id}  hero=${c.hero}/${c.expectedHero}  lifestyle=${c.lifestyle}/${TARGET_LIFESTYLE}+  closeup=${c.closeup}/${TARGET_CLOSEUP}+`);
  }
  console.log(`\n${okAll}/${productIds.length} products at full target.`);
  await prisma.$disconnect();
})();
