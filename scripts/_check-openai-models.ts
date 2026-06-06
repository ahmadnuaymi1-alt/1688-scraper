/**
 * Probe which OpenAI models are reachable on the configured key, and run a
 * tiny generation against a candidate model to confirm the parameter rules
 * (max_completion_tokens / temperature) GPT-5 family enforces.
 *
 *   npx tsx scripts/_check-openai-models.ts [modelId]
 */
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

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
  const candidate = process.argv[2] || "gpt-5.4-mini";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const list = await client.models.list();
  const ids = list.data.map((m) => m.id).sort();
  const interesting = ids.filter((id) => /gpt-5|gpt-4\.1|o3|o4/.test(id));
  console.log("Relevant models available on this key:");
  for (const id of interesting) console.log("  -", id);
  console.log(`(total ${ids.length} models)`);

  console.log(`\nTesting a tiny generation on "${candidate}" ...`);
  // First try the legacy param shape (max_tokens + temperature) the current
  // client uses — to see if it errors for GPT-5 family.
  try {
    const r = await client.chat.completions.create({
      model: candidate,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      max_tokens: 16,
      temperature: 0.5,
    });
    console.log("  legacy params OK ->", JSON.stringify(r.choices[0]?.message?.content));
  } catch (e) {
    console.log("  legacy params FAILED ->", e instanceof Error ? e.message : String(e));
  }
  // Then the GPT-5-style shape.
  try {
    const r = await client.chat.completions.create({
      model: candidate,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      max_completion_tokens: 16,
    });
    console.log("  new params OK ->", JSON.stringify(r.choices[0]?.message?.content));
  } catch (e) {
    console.log("  new params FAILED ->", e instanceof Error ? e.message : String(e));
  }
}
main().catch((e) => { console.error("UNHANDLED:", e instanceof Error ? e.message : e); process.exit(1); });
