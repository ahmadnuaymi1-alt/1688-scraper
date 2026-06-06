/**
 * Lightweight in-process AI usage + cost tracker.
 *
 * Every AI client (claude-client, openai-client, claude-pricing-client) reports
 * token usage here after each call. Summing is just numbers, so it's always on
 * and effectively free. `getUsageSummary()` computes USD cost from the pricing
 * table below; unknown models are reported with tokens but $0 cost + flagged.
 *
 * Scope is the current Node process (a script run, or one Next server lifetime).
 */

export type AiProvider = "anthropic" | "openai";

export interface RecordUsageInput {
  input?: number | null;
  output?: number | null;
  cacheWrite?: number | null;
  cacheRead?: number | null;
  webSearches?: number | null;
}

interface ModelUsage {
  provider: AiProvider;
  model: string;
  calls: number;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  webSearches: number;
}

const usage = new Map<string, ModelUsage>();

/** Normalize "claude-haiku-4-5-20251001" → "claude-haiku-4-5" for pricing lookup. */
function normalizeModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function recordUsage(provider: AiProvider, model: string, u: RecordUsageInput): void {
  const key = `${provider}:${normalizeModel(model)}`;
  const cur =
    usage.get(key) ??
    { provider, model: normalizeModel(model), calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearches: 0 };
  cur.calls += 1;
  cur.input += u.input ?? 0;
  cur.output += u.output ?? 0;
  cur.cacheWrite += u.cacheWrite ?? 0;
  cur.cacheRead += u.cacheRead ?? 0;
  cur.webSearches += u.webSearches ?? 0;
  usage.set(key, cur);
}

export function resetUsage(): void {
  usage.clear();
}

/** USD per 1,000,000 tokens. cacheWrite/cacheRead default to in × 1.25 / × 0.1. */
const PRICING: Record<string, { in: number; out: number; cacheWrite?: number; cacheRead?: number }> = {
  "claude-haiku-4-5": { in: 1.0, out: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-sonnet-4-5": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "claude-opus-4-8": { in: 5.0, out: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5": { in: 1.25, out: 10.0 },
};
const WEB_SEARCH_USD = 0.01; // Anthropic server-side web_search: $10 / 1,000 requests

export interface UsageRow extends ModelUsage {
  costUSD: number;
  priceKnown: boolean;
}
export interface UsageSummary {
  rows: UsageRow[];
  totalCostUSD: number;
  totalCalls: number;
  unknownModels: string[];
}

export function getUsageSummary(): UsageSummary {
  const rows: UsageRow[] = [];
  const unknownModels: string[] = [];
  let totalCostUSD = 0;
  let totalCalls = 0;

  for (const u of usage.values()) {
    const p = PRICING[u.model];
    const priceKnown = !!p;
    let cost = u.webSearches * WEB_SEARCH_USD;
    if (p) {
      cost += (u.input / 1e6) * p.in;
      cost += (u.output / 1e6) * p.out;
      cost += (u.cacheWrite / 1e6) * (p.cacheWrite ?? p.in * 1.25);
      cost += (u.cacheRead / 1e6) * (p.cacheRead ?? p.in * 0.1);
    } else if (!unknownModels.includes(u.model)) {
      unknownModels.push(u.model);
    }
    totalCostUSD += cost;
    totalCalls += u.calls;
    rows.push({ ...u, costUSD: cost, priceKnown });
  }
  rows.sort((a, b) => b.costUSD - a.costUSD);
  return { rows, totalCostUSD, totalCalls, unknownModels };
}

/** Pretty one-block summary for scripts. */
export function formatUsageSummary(): string {
  const s = getUsageSummary();
  const lines: string[] = ["=== AI usage / cost this run ==="];
  for (const r of s.rows) {
    const extras: string[] = [];
    if (r.cacheRead) extras.push(`cacheRead ${r.cacheRead.toLocaleString()}`);
    if (r.cacheWrite) extras.push(`cacheWrite ${r.cacheWrite.toLocaleString()}`);
    if (r.webSearches) extras.push(`${r.webSearches} web search(es)`);
    lines.push(
      `  ${r.provider}:${r.model}  ${r.calls} call(s)  in ${r.input.toLocaleString()} / out ${r.output.toLocaleString()}` +
        (extras.length ? `  (${extras.join(", ")})` : "") +
        `  → $${r.costUSD.toFixed(4)}${r.priceKnown ? "" : "  [PRICE UNKNOWN]"}`,
    );
  }
  lines.push(`  TOTAL: $${s.totalCostUSD.toFixed(4)} across ${s.totalCalls} call(s)`);
  if (s.unknownModels.length) lines.push(`  ⚠ no pricing for: ${s.unknownModels.join(", ")} (tokens counted, cost not)`);
  return lines.join("\n");
}
