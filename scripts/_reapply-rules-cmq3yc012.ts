/**
 * Reapply rules headlessly for cmq3yc012 (agent-mode batch).
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

const PRODUCT_ID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const { reapplyRules } = await import("../src/services/rule.service");
  const t0 = Date.now();
  await reapplyRules(PRODUCT_ID, ["description", "image", "title", "tags", "seo"]);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
