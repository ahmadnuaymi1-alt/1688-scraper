/**
 * Hero-image verification + per-product prompt overrides.
 *
 * Two concerns, shared by both hero scripts (_hf-cli-bulk-heroes.ts and
 * _hero-image-creator.ts):
 *
 *   1. buildHeroPrompt(productId) — the effective hero prompt, with precedence
 *      env HERO_PROMPT_OVERRIDE > per-product hero-overrides/<id>.json > HERO_PROMPT.
 *      Mirrors the scene-overrides/<id>.json pattern used by the lifestyle pipeline.
 *
 *   2. verifyAndMaybeRegenerate(...) — after a hero is generated, ask Gemini
 *      whether it matches its source image; on a CLEAR mismatch, regenerate (up
 *      to MAX_HERO_VERIFY_RETRIES); if it still mismatches, keep the last attempt
 *      and flag the product so per-product prompt notes can be added.
 *
 * Verification never blocks persistence: if the key is unset or the check
 * errors, the hero is kept exactly as today.
 */
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { HERO_PROMPT, HERO_PROMPT_GENERAL, HERO_PROMPT_WATCH } from "./prompt";
import { isLightingProduct, isWatchProduct } from "../../services/lifestyle-scene-designer.service";
import {
  geminiVisionMatch,
  isGeminiConfigured,
  type GeminiMatchResult,
} from "../ai/gemini-client";

const HERO_OVERRIDE_DIR = path.resolve(process.cwd(), "hero-overrides");

/** Number of REGENERATIONS allowed on a clear mismatch before flagging. */
export const MAX_HERO_VERIFY_RETRIES = Number(process.env.MAX_HERO_VERIFY_RETRIES ?? 2);

// ─────────────────────────────────────────────────────────────────────────────
// Per-product hero prompt overrides — mirror scene-overrides/<id>.json
// ─────────────────────────────────────────────────────────────────────────────
interface HeroOverride {
  /** Full replacement of HERO_PROMPT for this product. */
  heroPromptOverride?: string;
  /** Extra correction notes appended to the end of the effective prompt. */
  heroPromptExtraNotes?: string;
}

/**
 * Read hero-overrides/<productId>.json. Returns null on no productId, missing
 * file, malformed JSON, or no usable keys (defensive — never throws). Mirrors
 * loadOverride() in lifestyle-scene-designer.service.ts.
 */
export function loadHeroOverride(productId: string): HeroOverride | null {
  if (!productId) return null;
  const file = path.join(HERO_OVERRIDE_DIR, `${productId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
    const out: HeroOverride = {};
    if (typeof doc.heroPromptOverride === "string" && doc.heroPromptOverride.trim()) {
      out.heroPromptOverride = doc.heroPromptOverride.trim();
    }
    if (typeof doc.heroPromptExtraNotes === "string" && doc.heroPromptExtraNotes.trim()) {
      out.heroPromptExtraNotes = doc.heroPromptExtraNotes.trim();
    }
    if (!out.heroPromptOverride && !out.heroPromptExtraNotes) return null;
    return out;
  } catch (err) {
    console.warn(
      `[hero-override] failed to read ${file}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

/**
 * Effective hero prompt for a product. Precedence:
 *   1. process.env.HERO_PROMPT_OVERRIDE (global, for one-off experiments)
 *   2. hero-overrides/<productId>.json (heroPromptOverride replaces; heroPromptExtraNotes appends)
 *   3. base prompt by product kind: lighting → HERO_PROMPT (bulb-aware);
 *      non-lighting → HERO_PROMPT_GENERAL (general studio-cove, no light language).
 *
 * Pass `opts.title` / `opts.productType` so the lighting-vs-general branch can
 * run; with neither (back-compat) it defaults to the lighting HERO_PROMPT.
 */
export function buildHeroPrompt(
  productId: string,
  opts?: { title?: string; productType?: string },
): string {
  const envOverride = process.env.HERO_PROMPT_OVERRIDE;
  if (envOverride && envOverride.trim()) return envOverride;

  const classifyText = `${opts?.title ?? ""} ${opts?.productType ?? ""}`.trim();
  // Category overrides — the cornucopia pattern. Each category gets its own
  // baked-in prompt when classifyText positively matches. When no category
  // override fires, fall back to lighting vs. general (defaulting to lighting
  // when there's no signal, for back-compat with older callers).
  let prompt: string;
  if (classifyText && isWatchProduct(classifyText)) {
    prompt = HERO_PROMPT_WATCH;
  } else if (classifyText && !isLightingProduct(classifyText)) {
    prompt = HERO_PROMPT_GENERAL;
  } else {
    prompt = HERO_PROMPT;
  }

  const ov = loadHeroOverride(productId);
  if (ov?.heroPromptOverride) prompt = ov.heroPromptOverride;
  if (ov?.heroPromptExtraNotes) {
    prompt = `${prompt}\nPER-PRODUCT CORRECTIONS (highest priority, override anything above that conflicts): ${ov.heroPromptExtraNotes}`;
  }
  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify + regenerate
// ─────────────────────────────────────────────────────────────────────────────
export interface VerifyOpts {
  productId: string;
  productTitle: string;
  variantLabel: string;
  /** Source reference image: local file path, http(s) URL, or Buffer. */
  sourceImage: Buffer | string;
  /** One Higgsfield generation → hero PNG bytes. Called once, then once per retry. */
  generate: () => Promise<Buffer>;
}

export interface VerifyOutcome {
  buffer: Buffer;
  attempts: number;
  /** true = match/uncertain/low-confidence (kept); false = clear mismatch after retries (flagged). */
  passed: boolean;
  finalResult: GeminiMatchResult | null;
}

export interface FailedVerification {
  productId: string;
  productTitle: string;
  variantLabel: string;
  attempts: number;
  result: GeminiMatchResult;
  reviewUrl: string;
}

/**
 * Generate a hero, verify it matches its source, and regenerate on a CLEAR
 * mismatch (verdict "mismatch" with high|medium confidence) up to
 * MAX_HERO_VERIFY_RETRIES. match / uncertain / low-confidence all PASS (no
 * nuance redo). If the key is unset or the check errors, the hero is kept
 * (non-blocking). On persistent mismatch the last buffer is returned with
 * passed=false so the caller can flag the product.
 */
export async function verifyAndMaybeRegenerate(opts: VerifyOpts): Promise<VerifyOutcome> {
  let buffer = await opts.generate();
  let attempts = 1;

  if (!isGeminiConfigured()) {
    return { buffer, attempts, passed: true, finalResult: null };
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let result: GeminiMatchResult;
    try {
      result = await geminiVisionMatch({
        sourceImage: opts.sourceImage,
        heroImage: buffer,
        heroMime: "image/png",
      });
    } catch (err) {
      // Check failed — never block persistence; keep the hero.
      console.warn(
        `  [verify] check error (keeping hero): ${err instanceof Error ? err.message : err}`,
      );
      return { buffer, attempts, passed: true, finalResult: null };
    }

    const clearMismatch =
      result.verdict === "mismatch" && (result.confidence === "high" || result.confidence === "medium");

    if (!clearMismatch) {
      console.log(
        `  [verify] ${result.verdict}/${result.confidence} — keep (attempt ${attempts}): ${result.summary.slice(0, 120)}`,
      );
      return { buffer, attempts, passed: true, finalResult: result };
    }

    if (attempts > MAX_HERO_VERIFY_RETRIES) {
      console.log(
        `  [verify] STILL mismatch after ${attempts} attempt(s) — FLAGGED: ${result.summary.slice(0, 120)}`,
      );
      return { buffer, attempts, passed: false, finalResult: result };
    }

    console.log(
      `  [verify] mismatch/${result.confidence} (attempt ${attempts}) — regenerating: ${result.issues.join("; ").slice(0, 140)}`,
    );
    buffer = await opts.generate();
    attempts++;
  }
}

/** End-of-run report: which heroes failed the source-match check and need notes. */
export function printFailedVerifications(failed: FailedVerification[]): void {
  if (failed.length === 0) {
    console.log("\n[verify] All heroes passed the source-match check.");
    return;
  }
  console.log(`\n========== HERO IDENTITY MISMATCHES (${failed.length}) ==========`);
  for (const f of failed) {
    console.log(
      `  ✗ ${f.productTitle.slice(0, 50)} / ${f.variantLabel.slice(0, 30)}  (kept best after ${f.attempts} attempt(s))`,
    );
    console.log(`     ${f.result.summary}`);
    if (f.result.issues.length) console.log(`     issues: ${f.result.issues.join("; ")}`);
    console.log(`     review: ${f.reviewUrl}`);
    console.log(`     fix: add notes to hero-overrides/${f.productId}.json then re-run`);
  }
  console.log(`====================================================`);
}
