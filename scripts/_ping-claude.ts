/**
 * Tiny smoke test for the Claude API key in .env.local. Use to verify whether
 * description enrichment + variant translation are failing for an obvious
 * billing/auth reason vs. a real bug.
 *
 *   npx tsx scripts/_ping-claude.ts
 */
import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  process.stdout.write(`key set: ${!!key} | prefix: ${key.slice(0, 15)} | length: ${key.length}\n`);
  if (!key) {
    process.stdout.write("ANTHROPIC_API_KEY missing — that's the problem.\n");
    return;
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with the single word: PONG" }],
    }),
  });
  process.stdout.write(`status: ${res.status}\n`);
  const text = await res.text();
  process.stdout.write(`body: ${text.slice(0, 800)}\n`);
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
