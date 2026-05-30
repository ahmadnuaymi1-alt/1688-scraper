import fs from "node:fs";
import path from "node:path";
import { runPostScrapeAudit } from "../src/services/post-scrape-audit.service";

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

async function main() {
  const r = await runPostScrapeAudit("cmpjstlof005zw2ggy9gucyhh", null);
  console.log("\n=== Result ===");
  console.log(`Fixed=${r.totalFixed} Flagged=${r.totalFlagged}`);
  for (const c of r.checks) {
    console.log(`  [${c.check}] checked=${c.checked} fixed=${c.fixed} flagged=${c.flagged}`);
    for (const d of c.details) console.log(`    - ${d}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
