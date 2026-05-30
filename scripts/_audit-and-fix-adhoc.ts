/**
 * ONE-OFF: Run the new post-scrape audit on three specific products from the
 * user's adhoc list:
 *   - cmpjsvap800iew2ggixwlxdbn (13 variants with no source-image links)
 *   - cmpjsu8vd009vw2gg63xpg2fv (just want heroes — quick audit pass first)
 *   - cmpjswsmv00rfw2ggb4z2n7tb (no audit needed here; handled in a separate
 *     script that adds Circle / Black+White variants)
 *
 * Demonstrates the audit service end-to-end. Logs the per-product result so
 * we can see Check 2 (variant link fix) actually do its job on cmpjsvap8.
 *
 * Safe to delete after running.
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

const PRODUCT_IDS = [
  "cmpjsvap800iew2ggixwlxdbn",
  "cmpjsu8vd009vw2gg63xpg2fv",
];

async function main() {
  for (const pid of PRODUCT_IDS) {
    console.log(`\n======================================`);
    console.log(`AUDITING ${pid}`);
    console.log(`======================================`);
    const result = await runPostScrapeAudit(pid, null);
    console.log(`\n--- Result ---`);
    console.log(`Total fixed: ${result.totalFixed}`);
    console.log(`Total flagged: ${result.totalFlagged}`);
    console.log(`Duration: ${result.durationMs}ms`);
    for (const c of result.checks) {
      console.log(
        `  [${c.check}] checked=${c.checked} fixed=${c.fixed} flagged=${c.flagged}`,
      );
      for (const d of c.details) console.log(`    - ${d}`);
    }
  }
  console.log(`\nDone.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
