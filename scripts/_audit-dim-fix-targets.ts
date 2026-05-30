/**
 * Run the post-scrape audit (including new Check 8 dimensional enrichment)
 * on the 5 products with bare/incomplete dimension data.
 */
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

const IDS = [
  "cmpjswf6e00njw2ggf8fceqtd",
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsug3l00cpw2gg1r25v59u",
  "cmpjstyid007tw2ggulv0g8b3",
  "cmpjstlof005zw2ggy9gucyhh",
];

async function main() {
  for (const id of IDS) {
    console.log(`\n=== ${id} ===`);
    try {
      const r = await runPostScrapeAudit(id, null);
      console.log(`Fixed=${r.totalFixed} Flagged=${r.totalFlagged} Duration=${r.durationMs}ms`);
      for (const c of r.checks) {
        if (c.fixed === 0 && c.flagged === 0) continue;
        console.log(`  [${c.check}] fixed=${c.fixed} flagged=${c.flagged}`);
        for (const d of c.details) console.log(`    - ${d}`);
      }
    } catch (e) {
      console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nDone.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
