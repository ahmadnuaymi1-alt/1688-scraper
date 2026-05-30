/**
 * Shared OpenAI SDK wrapper.
 *
 * Provides a singleton `OpenAI` client plus two high-level helpers:
 *   - `openaiText()` — plain text completion (system + user → string)
 *   - `openaiJSON()` — text completion that returns parsed (and optionally
 *                     zod-validated) JSON, using OpenAI's JSON mode
 *
 * Every call funnels through `withRetry()` which retries 429 / 5xx up to 3
 * times with exponential backoff (1s → 2s → 4s). Mirrors the pattern in
 * `claude-client.ts`.
 */

import OpenAI from "openai";
import type { z } from "zod";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — cannot construct OpenAI client",
    );
  }
  if (!_client) {
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Whether an error should trigger a retry. Retries on:
 *   - HTTP 429 (rate limited)
 *   - HTTP 5xx (server error)
 *   - Network errors (no status)
 */
function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  if (typeof status === "number") {
    if (status === 429) return true;
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

export interface OpenAITextOpts {
  model?: string;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Single-turn text completion. Returns the message content string, trimmed.
 */
export async function openaiText(opts: OpenAITextOpts): Promise<string> {
  const client = getOpenAIClient();
  const model = opts.model ?? DEFAULT_OPENAI_MODEL;
  const maxTokens = opts.maxTokens ?? 4096;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (opts.system) {
    messages.push({ role: "system", content: opts.system });
  }
  messages.push({ role: "user", content: opts.user });

  const res = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages,
      max_tokens: maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    }),
  );

  const content = res.choices[0]?.message?.content ?? "";
  return content.trim();
}

export interface OpenAIJSONOpts<T> {
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
 * Text completion that expects a JSON response. Uses OpenAI's JSON mode
 * (`response_format: { type: "json_object" }`), which requires the output to
 * be an object. To support array-typed schemas, we instruct the model to
 * wrap arrays under a `"data"` key and unwrap before validation.
 */
export async function openaiJSON<T = unknown>(opts: OpenAIJSONOpts<T>): Promise<T> {
  const client = getOpenAIClient();
  const model = opts.model ?? DEFAULT_OPENAI_MODEL;
  const maxTokens = opts.maxTokens ?? 4096;

  // OpenAI's JSON mode requires the word "json" in the prompt/system and
  // requires an object response. We always nudge the model to wrap arrays in
  // `{ "data": [...] }` so callers with array schemas still work.
  const wrapInstruction =
    'Respond with a single JSON object. If the natural answer is an array, return it under the "data" key, e.g. {"data": [...]}.';
  const system = opts.system
    ? `${opts.system}\n\n${wrapInstruction}`
    : wrapInstruction;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: opts.user },
  ];

  const res = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    }),
  );

  const raw = (res.choices[0]?.message?.content ?? "").trim();
  const cleaned = extractJsonSubstring(stripMarkdownFences(raw));
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `openaiJSON: failed to parse JSON (${err instanceof Error ? err.message : err}). Raw (first 300): ${cleaned.slice(0, 300)}`,
    );
  }

  // If schema is provided and parsed is wrapped (the model added a top-level
  // object key because OpenAI JSON mode forbids top-level arrays), try
  // unwrapping. Tries — in order — the canonical "data" key, then any single
  // wrapper key whose value is an array. The latter catches `{ images: [...] }`
  // / `{ items: [...] }` / `{ result: [...] }` etc. that the model picks
  // when the user prompt names the entity (e.g. "rename N images").
  if (opts.schema) {
    const result = opts.schema.safeParse(parsed);
    if (result.success) return result.data;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const keys = Object.keys(obj);
      const candidates: unknown[] = [];
      if ("data" in obj) candidates.push(obj.data);
      // Single-key object whose value is an array → almost always a wrapper.
      if (keys.length === 1 && Array.isArray(obj[keys[0]])) {
        candidates.push(obj[keys[0]]);
      }
      // Multi-key object → try every key whose value is an array.
      for (const k of keys) {
        if (k === "data") continue;
        if (Array.isArray(obj[k])) candidates.push(obj[k]);
      }
      for (const c of candidates) {
        const r = opts.schema.safeParse(c);
        if (r.success) return r.data;
      }
    }
    // No candidate matched. Include a snippet of the raw model output in the
    // error so callers see WHY (e.g., wrong shape under the wrapper key) and
    // can adjust the prompt or schema.
    const preview = JSON.stringify(parsed).slice(0, 500);
    throw new Error(
      `openaiJSON: schema validation failed. Raw (first 500): ${preview}`,
      { cause: result.error },
    );
  }

  // No schema — return as-is. Caller is responsible for unwrapping `data`.
  return parsed as T;
}
