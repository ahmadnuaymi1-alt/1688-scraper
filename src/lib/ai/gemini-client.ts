/**
 * Gemini vision client — hero-image match verification.
 *
 * Reusable wrapper around Google's Gemini (gemini-2.5-flash) `generateContent`
 * endpoint for comparing two product images — a SOURCE reference vs an
 * AI-generated HERO — and returning a structured match verdict. Mirrors the
 * shape of `openai-client.ts` / `claude-client.ts` (lazy config check, retry on
 * 429/5xx, defensive JSON parse). Uses raw `fetch` — no SDK dependency.
 *
 * Public surface:
 *   - geminiVisionMatch({ sourceImage, heroImage }) → GeminiMatchResult
 *   - isGeminiConfigured()
 *   - DEFAULT_GEMINI_MODEL
 */
import fs from "node:fs";
import { Buffer } from "node:buffer";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

export function isGeminiConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GEMINI_VISION_API_KEY);
}

/**
 * Returns the API key to use for a Gemini call. Vision-tier callers (the hero
 * source-match verifier) pass `forVision: true` to prefer the dedicated paid
 * key in `GEMINI_VISION_API_KEY`; non-vision callers (or vision callers when
 * no paid key is set) fall back to `GEMINI_API_KEY` (the free tier).
 *
 * The split lets us burn the free quota first for everything else and reserve
 * the paid key for vision specifically, per the user's standing preference.
 */
function getGeminiApiKey(opts?: { forVision?: boolean }): string {
  if (opts?.forVision) {
    const visionKey = process.env.GEMINI_VISION_API_KEY;
    if (visionKey) return visionKey;
  }
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_VISION_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY / GEMINI_VISION_API_KEY is not set — cannot call Gemini");
  return key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry (mirrors openai-client.ts: 429 / 5xx / network, exponential backoff)
// ─────────────────────────────────────────────────────────────────────────────
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  return true; // network / no status → retry once
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryableError(err)) throw err;
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON parse helpers (copied from openai-client.ts)
// ─────────────────────────────────────────────────────────────────────────────
function stripMarkdownFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractJsonSubstring(s: string): string {
  const firstBrace = s.indexOf("{");
  if (firstBrace < 0) return s;
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace <= firstBrace) return s;
  return s.slice(firstBrace, lastBrace + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Image input handling — accepts Buffer | local path | http(s) URL | data: URI
// (mirrors the flexibility of claudeVision)
// ─────────────────────────────────────────────────────────────────────────────
function mimeFromExt(p: string): string {
  const e = p.toLowerCase();
  if (e.endsWith(".png")) return "image/png";
  if (e.endsWith(".webp")) return "image/webp";
  if (e.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function toInlineData(
  img: Buffer | string,
  mime?: string,
): Promise<{ mime_type: string; data: string }> {
  if (Buffer.isBuffer(img)) {
    return { mime_type: mime ?? "image/png", data: img.toString("base64") };
  }
  if (/^https?:\/\//i.test(img)) {
    const res = await fetch(img);
    if (!res.ok) throw new Error(`gemini: failed to fetch image ${res.status} ${img}`);
    const ct = res.headers.get("content-type") || "";
    const m = /^image\/(jpeg|png|webp|gif)/i.test(ct) ? ct.split(";")[0] : mime ?? "image/jpeg";
    return { mime_type: m, data: Buffer.from(await res.arrayBuffer()).toString("base64") };
  }
  if (img.startsWith("data:")) {
    const m = img.match(/^data:([^;]+);base64,(.*)$/);
    if (m) return { mime_type: m[1], data: m[2] };
  }
  if (fs.existsSync(img)) {
    return { mime_type: mime ?? mimeFromExt(img), data: fs.readFileSync(img).toString("base64") };
  }
  // Last resort: treat the string as raw base64.
  return { mime_type: mime ?? "image/png", data: img };
}

const MATCH_RUBRIC = `You are doing product-image QA. IMAGE 1 is the SOURCE reference (a real supplier photo of a product). IMAGE 2 is an AI-generated HERO image meant to depict the SAME product, restaged as a clean catalog shot. Decide whether the hero is acceptable.

Check 1 — IDENTITY: does the hero faithfully represent the same product identity as the source? Compare finish/colour, overall shape/silhouette, material, number of light apertures/heads/arms/bulbs (for lighting) or sub-dials/hands/markers/case/bracelet (for watches), and distinctive design features. IGNORE differences in background, lighting warmth, camera angle, framing/scale, micro-reflections and minor surface-texture rendering — the hero is deliberately restyled. Flag IDENTITY MISMATCH only for CLEAR errors: wrong finish/material/colour, wrong shape/silhouette, wrong count of features, a hallucinated or substituted different product, a missing or added major component.

Check 2 — COMMERCIAL POLISH (catalog cleanliness): the hero must show the product ALONE and CLEAN. Flag MISMATCH if the hero contains any of the following foreign / supplier artifacts that have NOT been stripped from the source:
  - White paper hang-tags tied to the product by a string or thread
  - Supplier certificate labels (e.g. "证书 / Certificate / Guarantee" cards)
  - Chinese-character price stickers ("¥3999", "零售价", "出厂价")
  - QR codes or barcodes stuck to or hanging from the product
  - Adhesive supplier brand stamps, watermarks, or watermark seals overlaid on the product
  - Loose strings, threads, or ribbons dangling from the product where they shouldn't be
  - Wholesale receipt slips or paper invoices attached to or sitting on the product
  - Tape, plastic wrap, protective film, or shipping labels left on the product
These artifacts are NORMAL on the 1688 source image; the hero pipeline is SUPPOSED to remove them. If they survived into the hero, the hero is NOT acceptable and the verdict is MISMATCH with reason "unstripped supplier <tag-type>".

Reply with ONLY strict minified JSON, no markdown:
{"verdict":"match|mismatch|uncertain","finish":"...","shape":"...","lights":"...","issues":["..."],"confidence":"high|medium|low","summary":"one sentence"}

In "issues", list each specific problem found — include both identity errors AND any unstripped supplier artifacts (e.g. "white paper hang-tag still tied to crown", "Chinese-character price label visible on left margin"). The "summary" should call out the most important reason if MISMATCH.`;

export interface GeminiMatchResult {
  verdict: "match" | "mismatch" | "uncertain";
  confidence: "high" | "medium" | "low";
  finish: string;
  shape: string;
  lights: string;
  issues: string[];
  summary: string;
  /** The raw model text, for logging/debugging. */
  raw: string;
}

export interface GeminiVisionMatchOpts {
  sourceImage: Buffer | string;
  heroImage: Buffer | string;
  model?: string;
  sourceMime?: string;
  heroMime?: string;
}

/**
 * Compare a hero image against its source reference and return a structured
 * match verdict. Throws on network/parse failure (callers decide whether a
 * failed check should block — the hero pipeline treats it as a non-blocking
 * pass).
 */
export async function geminiVisionMatch(opts: GeminiVisionMatchOpts): Promise<GeminiMatchResult> {
  const key = getGeminiApiKey({ forVision: true });
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const [src, hero] = await Promise.all([
    toInlineData(opts.sourceImage, opts.sourceMime),
    toInlineData(opts.heroImage, opts.heroMime),
  ]);

  const body = {
    contents: [
      {
        parts: [
          { text: "IMAGE 1 = SOURCE reference:" },
          { inline_data: { mime_type: src.mime_type, data: src.data } },
          { text: "IMAGE 2 = AI-generated HERO:" },
          { inline_data: { mime_type: hero.mime_type, data: hero.data } },
          { text: MATCH_RUBRIC },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      // gemini-2.5-flash is a reasoning model — disable "thinking" so its
      // tokens don't eat the output budget and truncate the JSON answer.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const text = await withRetry(async () => {
    const res = await fetch(ENDPOINT(model, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      const e = new Error(`Gemini HTTP ${res.status}: ${b.slice(0, 300)}`) as Error & {
        status?: number;
      };
      e.status = res.status;
      throw e;
    }
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const out = (json?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p?.text ?? "")
      .join("")
      .trim();
    if (!out) throw new Error(`Gemini returned no text: ${JSON.stringify(json).slice(0, 300)}`);
    return out;
  });

  const cleaned = extractJsonSubstring(stripMarkdownFences(text));
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `geminiVisionMatch: failed to parse JSON (${err instanceof Error ? err.message : err}). Raw (first 300): ${cleaned.slice(0, 300)}`,
    );
  }

  // Never trust the model's enums blindly — normalize.
  const verdict =
    parsed.verdict === "match" || parsed.verdict === "mismatch" ? parsed.verdict : "uncertain";
  const confidence =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";
  const issues = Array.isArray(parsed.issues) ? parsed.issues.map((x) => String(x)) : [];

  return {
    verdict,
    confidence,
    finish: String(parsed.finish ?? ""),
    shape: String(parsed.shape ?? ""),
    lights: String(parsed.lights ?? ""),
    issues,
    summary: String(parsed.summary ?? ""),
    raw: text,
  };
}
