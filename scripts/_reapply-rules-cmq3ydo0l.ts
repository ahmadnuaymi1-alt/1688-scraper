/**
 * Step 9: Reapply rules for cmq3ydo0l000jw288ns3doet5.
 * Categories: description, image, title, tags, seo.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq3ydo0l000jw288ns3doet5";

async function main() {
  const { reapplyRules } = await import("../src/services/rule.service");
  console.log(`\n=== reapplyRules(${PID}, all categories) ===`);
  const t0 = Date.now();
  const result = await reapplyRules(PID, ["description", "image", "title", "tags", "seo"]);
  console.log(`reapplyRules done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("Result:", JSON.stringify(result, null, 2).slice(0, 3000));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
