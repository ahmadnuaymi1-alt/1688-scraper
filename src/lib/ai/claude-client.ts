/**
 * Shared Anthropic SDK wrapper.
 *
 * Provides a singleton `Anthropic` client plus three high-level helpers:
 *   - `claudeText()`   — plain text completion (system + user → string)
 *   - `claudeVision()` — vision call accepting either a remote URL or base64 data
 *   - `claudeJSON()`   — text completion that returns parsed (and optionally
 *                        zod-validated) JSON
 *
 * Every call funnels through `withRetry()` which retries 429 / 529 (overloaded)
 * up to 3 times with exponential backoff (1s → 2s → 4s).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set — cannot construct Anthropic client",
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Whether an error should trigger a retry. Retries on:
 *   - HTTP 429 (rate limited)
 *   - HTTP 529 (overloaded)
 *   - HTTP 5xx (server error)
 *   - Network errors (no status)
 */
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    if (status === 429 || status === 529) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // Network / fetch error with no status — retry once
  return true;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryableError(err)) {
        throw err;
      }
      const waitMs = 1000 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  // Unreachable, but TS doesn't know that
  throw lastErr;
}

type ClaudeMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function normalizeMediaType(mime: string | undefined | null): ClaudeMediaType {
  const t = (mime ?? "image/jpeg").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/png" || t === "image/gif" || t === "image/webp") {
    return t;
  }
  return "image/jpeg";
}

export interface ClaudeTextOpts {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Single-turn text completion. Returns the concatenated text from all
 * `text`-typed content blocks in the response.
 */
export async function claudeText(opts: ClaudeTextOpts): Promise<string> {
  const client = getClaudeClient();
  const model = opts.model ?? DEFAULT_CLAUDE_MODEL;
  const maxTokens = opts.maxTokens ?? 4096;

  const res = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.user }],
    }),
  );

  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface ClaudeVisionOpts {
  model?: string;
  /**
   * Either a remote `https://…` URL, an inline `data:image/png;base64,…` URI,
   * or a raw base64 string (in which case `mediaType` should be set).
   */
  imageUrl: string;
  /** Optional explicit media type when `imageUrl` is a raw base64 string. */
  mediaType?: ClaudeMediaType;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Vision call. Accepts either a remote URL or base64-encoded image data.
 * If a remote URL is provided, the image is downloaded server-side and sent
 * inline (Anthropic's URL source path also works but inline is more reliable
 * for supplier-image hosts that gate hotlinking).
 */
export async function claudeVision(opts: ClaudeVisionOpts): Promise<string> {
  const client = getClaudeClient();
  const model = opts.model ?? DEFAULT_CLAUDE_MODEL;
  const maxTokens = opts.maxTokens ?? 2048;

  let imageBlock: Anthropic.ImageBlockParam;

  if (opts.imageUrl.startsWith("data:")) {
    // data:image/png;base64,XXXX
    const match = opts.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data: URI passed to claudeVision()");
    }
    imageBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: normalizeMediaType(match[1]),
        data: match[2],
      },
    };
  } else if (/^https?:\/\//i.test(opts.imageUrl)) {
    // Download → base64 inline (more reliable than url source for some hosts)
    const imgRes = await fetch(opts.imageUrl);
    if (!imgRes.ok) {
      throw new Error(
        `claudeVision: failed to download image (${imgRes.status} ${imgRes.statusText})`,
      );
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mt = normalizeMediaType(imgRes.headers.get("content-type"));
    imageBlock = {
      type: "image",
      source: { type: "base64", media_type: mt, data: buf.toString("base64") },
    };
  } else {
    // Treat as raw base64 string
    imageBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: opts.mediaType ?? "image/jpeg",
        data: opts.imageUrl,
      },
    };
  }

  const res = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.system ? { system: opts.system } : {}),
      messages: [
        {
          role: "user",
          content: [imageBlock, { type: "text", text: opts.prompt }],
        },
      ],
    }),
  );

  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface ClaudeJSONOpts<T> {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Optional zod schema — if provided, output is validated via `schema.parse()`. */
  schema?: z.ZodType<T>;
}

function stripMarkdownFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractJsonSubstring(s: string): string {
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);
  if (start < 0) return s;
  const lastBrace = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end <= start) return s;
  return s.slice(start, end + 1);
}

/**
 * Text completion that expects a JSON response. Strips markdown fences, finds
 * the outermost JSON object/array, parses, and optionally validates via zod.
 */
export async function claudeJSON<T = unknown>(opts: ClaudeJSONOpts<T>): Promise<T> {
  const raw = await claudeText({
    model: opts.model,
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
  });
  const cleaned = extractJsonSubstring(stripMarkdownFences(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `claudeJSON: failed to parse JSON (${err instanceof Error ? err.message : err}). Raw (first 300): ${cleaned.slice(0, 300)}`,
    );
  }
  if (opts.schema) {
    return opts.schema.parse(parsed);
  }
  return parsed as T;
}
