/**
 * Shared Higgsfield CLI helper used by hero + lifestyle image creators.
 *
 * Drives the official `higgsfield` CLI (`upload create … --json` and
 * `generate create nano_banana_2 … --wait`) with Windows-safe argument
 * quoting. Mirrors the pattern in `_hf-cli-bulk-heroes.ts` /
 * `_test-higgsfield-cli-hero.ts` so all three pipelines stay consistent.
 *
 * Public surface:
 *   - higgsfieldUpload(file)          → upload id
 *   - higgsfieldGenerate({...})       → { imageBuffer, resultUrl }
 *   - runHiggsfieldCliBatch({...})    → drop-in replacement for
 *                                       runHiggsfieldBatch() from
 *                                       `_higgsfield-lifestyle.ts`.
 *   - makeLimit(n)                    → tiny concurrency limiter
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { acquireSlot } from "./_hf-inflight-gate";

// ─────────────────────────────────────────────────────────────────────────────
// Low-level CLI invocation
// ─────────────────────────────────────────────────────────────────────────────
function spawnHiggsfield(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    // Windows Node won't spawn .cmd with shell:false (CVE-2024-27980), but
    // shell:true with an args array gets re-parsed by cmd.exe and corrupts
    // multi-line prompts. Build the whole command as one string with each arg
    // explicitly double-quoted (inner " escaped as ""), then spawn that single
    // string with shell:true.
    const quoted = args.map((a) => `"${a.replace(/"/g, '""')}"`).join(" ");
    const cmd = `higgsfield ${quoted}`;
    const proc = spawn(cmd, [], { shell: true });
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? -1, out }));
    proc.on("error", (err) => resolve({ code: -1, out: err.message }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-account auto-switch
//
// The CLI stores ONE account's tokens in ~/.config/higgsfield/credentials.json.
// We keep a second account's tokens in credentials.backup.json (captured once
// via `higgsfield auth login` + a file copy). When the active account runs out
// of credits mid-run, swap the backup file over the active one and retry — no
// browser re-login needed, since the file just holds access + refresh tokens.
// ─────────────────────────────────────────────────────────────────────────────
const HF_CRED_DIR = path.join(os.homedir(), ".config", "higgsfield");
const HF_ACTIVE_CRED = path.join(HF_CRED_DIR, "credentials.json");
const HF_BACKUP_CRED = path.join(HF_CRED_DIR, "credentials.backup.json");
const HF_MIN_CREDITS = 2; // one nano_banana_2 image costs 2 credits

let _switchedToBackup = false;

/** Active account's credit balance via `account status`, or null if unparseable. */
async function higgsfieldCredits(): Promise<number | null> {
  const r = await spawnHiggsfield(["account", "status"]);
  const m = r.out.match(/([\d,]+(?:\.\d+)?)\s*credits/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

/** Copy the backup account's tokens over the active credentials file. Idempotent. */
function switchToBackupAccount(): boolean {
  if (_switchedToBackup) return true;
  try {
    if (!fs.existsSync(HF_BACKUP_CRED)) return false;
    fs.copyFileSync(HF_BACKUP_CRED, HF_ACTIVE_CRED);
    _switchedToBackup = true;
    return true;
  } catch {
    return false;
  }
}

export function runHiggsfieldCli(args: string[]): Promise<{ code: number; out: string }> {
  return (async () => {
    let r = await spawnHiggsfield(args);
    // Auto-switch: if a generation failed and the active account is genuinely
    // out of credits, flip to the backup account (once) and retry the command.
    // Gated on an actual balance check so unrelated failures never switch.
    const isGenerate = args[0] === "generate" && args[1] === "create";
    if (r.code !== 0 && isGenerate && fs.existsSync(HF_BACKUP_CRED)) {
      if (!_switchedToBackup) {
        const credits = await higgsfieldCredits();
        if (credits !== null && credits < HF_MIN_CREDITS && switchToBackupAccount()) {
          console.log(
            `[higgsfield] active account out of credits (${credits}) — switched to backup account.`,
          );
        }
      }
      // Whoever triggered the switch, every failed generate retries once on backup.
      if (_switchedToBackup) {
        r = await spawnHiggsfield(args);
      }
    }
    return r;
  })();
}

function extractJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`no JSON in CLI output: ${raw.slice(-200)}`);
  return JSON.parse(match[0]) as T;
}

/**
 * Upload a local file to Higgsfield and return the upload id. Retries up to
 * twice on transient backend errors (HTTP 5xx) — Higgsfield's upload endpoint
 * occasionally returns 502/503/504 under bursty load, and the CLI surfaces
 * those as a non-zero exit. Other errors (4xx, "file not found", auth) surface
 * immediately on first attempt.
 */
export async function higgsfieldUpload(file: string): Promise<string> {
  const maxAttempts = 3;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await runHiggsfieldCli(["upload", "create", file, "--json"]);
    if (r.code === 0) {
      const parsed = extractJson<{ id?: string }>(r.out);
      if (!parsed.id) {
        throw new Error(`upload returned no id for ${file}: ${r.out.slice(-200)}`);
      }
      return parsed.id;
    }
    lastErr = `exit ${r.code}: ${r.out.slice(-200)}`;
    // Only retry on 5xx — anything else is the user's problem (bad path, auth, etc.).
    const isTransient = /HTTP 5\d\d|error code: 5\d\d|ETIMEDOUT|ECONNRESET/.test(r.out);
    if (!isTransient || attempt === maxAttempts) break;
    const delayMs = 1500 * attempt; // 1.5s, 3s
    await new Promise((res) => setTimeout(res, delayMs));
  }
  throw new Error(`upload failed for ${file} after ${maxAttempts} attempts: ${lastErr}`);
}

export function extractResultUrl(out: string): string | null {
  // Pull every https URL that looks like a render-bucket image. Higgsfield's
  // upload bucket is `d2ol…`; render bucket is `d8j0…` (or similar). Pick the
  // first non-upload URL.
  const urls = out.match(/https?:\/\/[^\s"',)]+\.(?:png|jpe?g|webp)/gi) || [];
  if (urls.length === 0) return null;
  const result = urls.find((u) => !u.includes("d2ol"));
  return result ?? urls[urls.length - 1];
}

export interface GenerateOpts {
  prompt: string;
  /** Upload ids returned from `higgsfieldUpload`. Each is wrapped as
   *  `{ id, type: "media_input" }` for the CLI's `--input_images` arg. */
  inputUploadIds: string[];
  /** Defaults to "1:1". */
  aspectRatio?: string;
  /** Defaults to "1k". */
  resolution?: string;
  /** Defaults to "nano_banana_2" (Nano Banana Pro). */
  model?: string;
}

export async function higgsfieldGenerate(
  opts: GenerateOpts,
): Promise<{ imageBuffer: Buffer; resultUrl: string }> {
  const inputImagesJson = JSON.stringify(
    opts.inputUploadIds.map((id) => ({ id, type: "media_input" })),
  );
  // cmd.exe doesn't survive literal newlines inside quoted args — collapse.
  const promptOneLine = opts.prompt.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const args = [
    "generate", "create", opts.model ?? "nano_banana_2",
    "--prompt", promptOneLine,
    "--input_images", inputImagesJson,
    "--aspect_ratio", opts.aspectRatio ?? "1:1",
    "--resolution", opts.resolution ?? "1k",
    "--wait",
  ];
  // Global cross-process in-flight cap (no-op unless HIGGSFIELD_MAX_INFLIGHT set).
  // Held only around the generation spawn; the download below doesn't hold a slot.
  const release = await acquireSlot();
  let r: { code: number; out: string };
  try {
    r = await runHiggsfieldCli(args);
  } finally {
    release();
  }
  if (r.code !== 0) {
    throw new Error(`generate exit ${r.code}: ${r.out.slice(-300)}`);
  }
  const resultUrl = extractResultUrl(r.out);
  if (!resultUrl) {
    throw new Error(`no result URL in CLI output: ${r.out.slice(-300)}`);
  }
  const res = await fetch(resultUrl);
  if (!res.ok) {
    throw new Error(`download result ${res.status} ${resultUrl}`);
  }
  return { imageBuffer: Buffer.from(await res.arrayBuffer()), resultUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency limiter (no extra dep)
// ─────────────────────────────────────────────────────────────────────────────
export function makeLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((res) => queue.push(res));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch wrapper — drop-in for runHiggsfieldBatch() from `_higgsfield-lifestyle.ts`
// ─────────────────────────────────────────────────────────────────────────────
export interface CliBatchPrompt {
  slug: string;
  text: string;
  /** Local file paths to upload as `media_input` refs. The lifestyle path
   *  passes one (the variant hero); the hero path passes two (variant +
   *  positioning template). */
  referenceImage: string[];
}

export interface CliBatchOpts {
  prompts: CliBatchPrompt[];
  /** Each successful generation is written to `${outDir}/${slug}.png`. */
  outDir: string;
  /** Parallel CLI jobs. Default 6. Set to 1 for sequential. */
  concurrency?: number;
}

export async function runHiggsfieldCliBatch(
  opts: CliBatchOpts,
): Promise<{ ok: number; fail: number }> {
  fs.mkdirSync(opts.outDir, { recursive: true });
  const limit = makeLimit(opts.concurrency ?? 6);
  let ok = 0;
  let fail = 0;
  // Cache upload-ids by file path within this batch so the same reference
  // (e.g. a single hero shared by multiple sister scenes) isn't re-uploaded.
  const uploadCache = new Map<string, Promise<string>>();
  const uploadOnce = (file: string): Promise<string> => {
    const cached = uploadCache.get(file);
    if (cached) return cached;
    const p = higgsfieldUpload(file);
    uploadCache.set(file, p);
    return p;
  };

  await Promise.all(
    opts.prompts.map((p, idx) =>
      limit(async () => {
        const t0 = Date.now();
        try {
          const uploadIds = await Promise.all(p.referenceImage.map(uploadOnce));
          const { imageBuffer } = await higgsfieldGenerate({
            prompt: p.text,
            inputUploadIds: uploadIds,
          });
          const outPath = path.join(opts.outDir, `${p.slug}.png`);
          fs.writeFileSync(outPath, imageBuffer);
          const sec = Math.round((Date.now() - t0) / 1000);
          console.log(`  [${idx + 1}/${opts.prompts.length}] OK ${sec}s  ${p.slug}`);
          ok++;
        } catch (e) {
          const sec = Math.round((Date.now() - t0) / 1000);
          const msg = e instanceof Error ? e.message : String(e);
          console.log(
            `  [${idx + 1}/${opts.prompts.length}] FAIL ${sec}s  ${p.slug}: ${msg.slice(0, 200)}`,
          );
          fail++;
        }
      }),
    ),
  );
  return { ok, fail };
}
