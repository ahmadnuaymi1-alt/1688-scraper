/**
 * Opt-in GLOBAL (cross-process) in-flight cap for Higgsfield image generation.
 *
 * Why: `makeLimit()` in `_higgsfield-cli.ts` is an in-PROCESS semaphore only.
 * When agent-mode runs N products in parallel (one process each), their local
 * limiters don't see each other, so total in-flight = N × per-process concurrency
 * — which overshoots the account's hard ceiling (8) and triggers throttling /
 * credit auto-swap. This gate caps the TOTAL across every process at one number.
 *
 * Activation is OPT-IN via env `HIGGSFIELD_MAX_INFLIGHT`:
 *   - unset / non-numeric / <= 0  → acquireSlot() is a NO-OP (returns a no-op
 *     release immediately). Default (non-agent-mode) behavior is byte-for-byte
 *     unchanged — nothing in the normal hero/lifestyle path changes.
 *   - set to e.g. 8 (the batch launcher sets this once) → every higgsfieldGenerate
 *     call across all processes must claim one of 8 file-token slots before it
 *     spawns the CLI, and releases it after.
 *
 * Mechanism: a token directory in the OS temp dir with `slot-<i>.lock` files.
 * Atomicity comes from `fs.openSync(path, "wx")` (O_EXCL) — exactly one process
 * can create a given slot file; everyone else gets EEXIST and tries the next.
 * Crash-safety: each slot stamps {pid, t}; any slot older than STALE_MS (or
 * unreadable) is reaped on the next acquire, so a crashed run frees its slots
 * within one cycle. Manual reset: delete %TEMP%\hf-inflight-gate.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const RAW = process.env.HIGGSFIELD_MAX_INFLIGHT;
const MAX = RAW ? parseInt(RAW, 10) : NaN;
const ENABLED = Number.isFinite(MAX) && MAX > 0;

const GATE_DIR = path.join(os.tmpdir(), "hf-inflight-gate");
const STALE_MS = 8 * 60_000; // a single `generate --wait` is well under this

function reapStale(): void {
  let names: string[];
  try {
    names = fs.readdirSync(GATE_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".lock")) continue;
    const p = path.join(GATE_DIR, name);
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const { t } = JSON.parse(raw) as { t?: number };
      if (typeof t !== "number" || now - t > STALE_MS) {
        fs.unlinkSync(p);
      }
    } catch {
      // unreadable / partial write / vanished — best-effort reap
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
  }
}

/**
 * Acquire one of the MAX global slots. Returns a release() closure (idempotent).
 * No-op (resolves immediately with a no-op release) when the gate is disabled.
 */
export async function acquireSlot(): Promise<() => void> {
  if (!ENABLED) return () => {};
  try { fs.mkdirSync(GATE_DIR, { recursive: true }); } catch { /* exists */ }

  for (;;) {
    reapStale();
    for (let i = 0; i < MAX; i++) {
      const slot = path.join(GATE_DIR, `slot-${i}.lock`);
      let fd: number | null = null;
      try {
        fd = fs.openSync(slot, "wx"); // atomic create-exclusive
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() }));
        fs.closeSync(fd);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try { fs.unlinkSync(slot); } catch { /* already reaped */ }
        };
      } catch {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* noop */ } }
        // slot taken — try the next one
      }
    }
    // all slots busy — back off with jitter, then retry
    await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 250)));
  }
}

export const inflightGateEnabled = ENABLED;
export const inflightGateMax = ENABLED ? MAX : 0;
