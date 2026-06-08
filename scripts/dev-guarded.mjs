/**
 * Guarded `next dev` supervisor.
 *
 * Why this exists: Next.js 16 + Turbopack has two classes of dev-server
 * failure on this machine that both leave the user staring at a Next.js
 * runtime error overlay with no way back except restarting the dev server
 * manually:
 *
 *   A) PostCSS worker flood — Turbopack runs Tailwind through PostCSS child
 *      processes (`.next/dev/build/postcss.js`). If that generated worker
 *      script is corrupt (which happens when a dev server is hard-killed
 *      mid-build — including by this watchdog or by Ctrl+C), the worker
 *      crashes on startup and Turbopack respawns it with no limit and no
 *      backoff: a runaway loop that piles up hundreds of `node.exe` processes
 *      and freezes the PC.
 *
 *   B) Jest-worker death mid-session — Turbopack's build pool occasionally
 *      surfaces "Jest worker encountered N child process exceptions,
 *      exceeding retry limit" after the dev server has been running for a
 *      while (compiling a heavy module graph like /review/[id]). No JS
 *      stderr; the child is killed mid-flight by the OS or a native abort.
 *      The session is dead; previously the user had to type "npm run dev"
 *      again.
 *
 * This supervisor handles both:
 *   1. cleanState() — kill leftover orphaned postcss workers + wipe the
 *      `.next` cache. Runs BEFORE the first start AND between every
 *      restart so a corrupt worker script can't trigger the flood on the
 *      next start either.
 *   2. startDev() — spawn `next dev` (with `--max-old-space-size=4096`
 *      merged into NODE_OPTIONS so the build graph has heap headroom),
 *      run the postcss watchdog (WORKER_LIMIT=25), wait for the child to
 *      exit, resolve with the exit code + whether the watchdog tripped.
 *   3. supervise() — call cleanState() then startDev() in a loop. On a
 *      non-clean exit, restart up to MAX_RESTARTS (=5) times within a
 *      RESTART_WINDOW_MS (=60s) rolling window. On the 6th crash in the
 *      window, give up so a genuinely-broken config error reaches the
 *      user instead of looping forever.
 *
 * Escape hatch: `npm run dev:webpack` adds `--webpack` to argv, which is
 * Next 16's documented way to opt out of Turbopack. In that mode we skip
 * the postcss watchdog (no workers to count) but keep the .next wipe +
 * supervisor loop active.
 *
 * A healthy dev session uses 1-3 postcss workers. WORKER_LIMIT is set well
 * above that, so it only ever fires on a genuine runaway.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const WORKER_LIMIT = 25;
const POLL_MS = 4000;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
const RESTART_BACKOFF_MS = 1500;
const HEAP_MB = 4096;
const isWin = process.platform === 'win32';

// Forwarded args. `--webpack` is Next 16's opt-out flag; when present we
// suppress the postcss watchdog since the postcss-worker pool isn't used.
const forwardedArgs = process.argv.slice(2);
const webpackMode = forwardedArgs.includes('--webpack');

// Module-scoped state so signal handlers (registered ONCE below) can
// reach the currently-running child without re-registering each restart.
let currentChild = null;
let shuttingDown = false;

/** Return PIDs of every Turbopack postcss worker process. */
function postcssWorkerPids() {
  try {
    if (isWin) {
      const ps =
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
        "Where-Object { $_.CommandLine -like '*\\.next\\dev\\build\\postcss.js*' } | " +
        'ForEach-Object { $_.ProcessId }';
      const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        encoding: 'utf8',
      });
      return out.split(/\s+/).filter(Boolean);
    }
    const out = execFileSync('pgrep', ['-f', '.next/dev/build/postcss.js'], {
      encoding: 'utf8',
    });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return []; // no matches -> non-zero exit -> treat as empty
  }
}

function killPids(pids) {
  for (const pid of pids) {
    try {
      if (isWin) execFileSync('taskkill', ['/F', '/PID', pid]);
      else process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    else process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/** Pre-start cleanup. Called before EVERY start (first + every restart). */
function cleanState() {
  // 1a. Kill orphaned postcss workers from any previous run.
  const stale = postcssWorkerPids();
  if (stale.length) {
    console.log(`[dev-guarded] cleaning up ${stale.length} leftover postcss worker(s)...`);
    killPids(stale);
  }
  // 1b. Wipe the .next build cache. A hard-killed dev server (the watchdog
  // below, or Ctrl+C mid-build) leaves .next/dev/build/postcss.js corrupt;
  // Turbopack then crash-loops that worker on the NEXT start — the real root
  // cause of the postcss flood. A clean cache every start breaks the cycle.
  try {
    rmSync('.next', { recursive: true, force: true });
    console.log('[dev-guarded] cleared .next build cache');
  } catch (err) {
    console.log(`[dev-guarded] could not clear .next (${err.code || err.message}) — continuing`);
  }
}

/**
 * Spawn `next dev` once and wait for it to exit. Returns the exit shape
 * the supervisor uses to decide whether to restart. Never throws — always
 * resolves, even on spawn error.
 */
function startDev() {
  return new Promise((resolve) => {
    // Merge our heap-size flag into NODE_OPTIONS so the spawned next process
    // (which is what actually holds the Turbopack build graph) gets the
    // bigger heap, not just this wrapper.
    const heapFlag = `--max-old-space-size=${HEAP_MB}`;
    const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
    const mergedNodeOptions = existingNodeOptions.includes('--max-old-space-size')
      ? existingNodeOptions
      : `${existingNodeOptions} ${heapFlag}`.trim();

    const nextBin = require.resolve('next/dist/bin/next');
    const child = spawn(process.execPath, [nextBin, 'dev', ...forwardedArgs], {
      stdio: 'inherit',
      detached: !isWin, // own process group on POSIX so we can signal the tree
      env: { ...process.env, NODE_OPTIONS: mergedNodeOptions },
    });
    currentChild = child;

    let tripped = false;
    let timer = null;

    // PostCSS watchdog — only useful in Turbopack mode (webpack doesn't use
    // the postcss child pool that floods).
    if (!webpackMode) {
      timer = setInterval(() => {
        const count = postcssWorkerPids().length;
        if (count > WORKER_LIMIT && !tripped) {
          tripped = true;
          console.error(
            `\n[dev-guarded] RUNAWAY DETECTED: ${count} postcss workers (limit ${WORKER_LIMIT}).\n` +
              `[dev-guarded] Killing the dev server before it takes down your PC.\n` +
              `[dev-guarded] This usually means the machine is low on memory — close some\n` +
              `[dev-guarded] apps (or reboot). The supervisor will auto-restart shortly.\n`,
          );
          clearInterval(timer);
          timer = null;
          killTree(child.pid);
          // resolve will fire on the child's 'exit' event below
        }
      }, POLL_MS);
    }

    const finalize = (code, signal) => {
      if (timer) clearInterval(timer);
      timer = null;
      killPids(postcssWorkerPids());
      currentChild = null;
      resolve({ code, signal, trippedByWatchdog: tripped });
    };

    child.on('exit', (code, signal) => finalize(code, signal));
    child.on('error', (err) => {
      console.error(`[dev-guarded] spawn error: ${err.message}`);
      finalize(1, null);
    });
  });
}

/**
 * Restart loop. Rolling 60s window. After MAX_RESTARTS crashes inside
 * that window the supervisor surrenders so a genuine config error
 * reaches the user instead of looping forever.
 */
async function supervise() {
  const restarts = []; // timestamps of recent restarts
  while (!shuttingDown) {
    cleanState();
    const result = await startDev();
    if (shuttingDown) return;

    // Prune timestamps outside the window.
    const now = Date.now();
    while (restarts.length && now - restarts[0] > RESTART_WINDOW_MS) {
      restarts.shift();
    }

    // Clean exit AND watchdog never tripped → user asked to stop.
    if ((result.code === 0 || result.code == null) && !result.trippedByWatchdog && result.signal == null) {
      process.exit(0);
    }

    restarts.push(now);
    if (restarts.length > MAX_RESTARTS) {
      console.error(
        `\n[dev-guarded] ${MAX_RESTARTS}+ crashes within ${RESTART_WINDOW_MS / 1000}s — ` +
          `giving up so you can see the real error.`,
      );
      process.exit(result.code ?? 1);
    }

    const reason = result.trippedByWatchdog
      ? 'watchdog runaway'
      : `code=${result.code} signal=${result.signal ?? '—'}`;
    console.error(
      `\n[dev-guarded] dev server exited (${reason}) — auto-restarting ` +
        `(attempt ${restarts.length}/${MAX_RESTARTS} in window)...\n`,
    );
    await new Promise((r) => setTimeout(r, RESTART_BACKOFF_MS));
  }
}

// Signal handlers — registered ONCE at module scope, not per-start, so the
// supervisor loop doesn't leak listeners (MaxListenersExceededWarning).
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    shuttingDown = true;
    if (currentChild?.pid) killTree(currentChild.pid);
    killPids(postcssWorkerPids());
    process.exit(0);
  });
}

if (webpackMode) {
  console.log('[dev-guarded] webpack mode — postcss watchdog disabled');
}

supervise().catch((err) => {
  console.error('[dev-guarded] supervisor crashed:', err);
  process.exit(1);
});
