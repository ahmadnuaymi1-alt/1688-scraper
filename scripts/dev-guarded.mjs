/**
 * Guarded `next dev` launcher.
 *
 * Why this exists: Next.js 16 + Turbopack runs Tailwind through PostCSS
 * child processes (`.next/dev/build/postcss.js`). When the machine is low on
 * memory a worker fails to start, and Turbopack respawns it with no limit and
 * no backoff — a runaway loop that piles up thousands of orphaned `node.exe`
 * processes, exhausts the Windows commit limit, and makes the WHOLE PC throw
 * "out of memory" errors. The orphans also survive after the dev server exits.
 *
 * This wrapper:
 *   1. Kills leftover orphaned postcss workers BEFORE starting (clears yesterday's mess).
 *   2. Runs `next dev`.
 *   3. Polls the postcss worker count; if it crosses WORKER_LIMIT it kills the
 *      whole dev tree + every postcss worker and exits — capping the blast
 *      radius at a harmless ~25 processes instead of 1400+.
 *   4. Cleans up all postcss workers on exit / Ctrl+C.
 *
 * A healthy dev session uses 1-3 postcss workers. WORKER_LIMIT is set well
 * above that, so it only ever fires on a genuine runaway.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WORKER_LIMIT = 25;
const POLL_MS = 4000;
const isWin = process.platform === 'win32';

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
  try {
    if (isWin) execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    else process.kill(-pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

// 1. Pre-start cleanup of orphaned workers from previous sessions.
const stale = postcssWorkerPids();
if (stale.length) {
  console.log(`[dev-guarded] cleaning up ${stale.length} leftover postcss worker(s)...`);
  killPids(stale);
}

// 2. Launch next dev.
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  detached: !isWin, // own process group on POSIX so we can signal the tree
});

let tripped = false;

// 3. Watchdog.
const timer = setInterval(() => {
  const count = postcssWorkerPids().length;
  if (count > WORKER_LIMIT && !tripped) {
    tripped = true;
    console.error(
      `\n[dev-guarded] RUNAWAY DETECTED: ${count} postcss workers (limit ${WORKER_LIMIT}).\n` +
        `[dev-guarded] Killing the dev server before it takes down your PC.\n` +
        `[dev-guarded] This usually means the machine is low on memory — close some\n` +
        `[dev-guarded] apps (or reboot) and run "npm run dev" again.\n`,
    );
    clearInterval(timer);
    killTree(child.pid);
    killPids(postcssWorkerPids());
    process.exit(1);
  }
}, POLL_MS);

// 4. Cleanup on exit.
function cleanup() {
  clearInterval(timer);
  killPids(postcssWorkerPids());
}
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    killTree(child.pid);
    cleanup();
    process.exit(0);
  });
}
