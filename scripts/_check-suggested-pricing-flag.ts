import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
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
const IDS = [
  "cmpvdwok500frw2hk9nmld4k0","cmpvdvyra00dbw2hktxto64m0","cmpvdvrbu00atw2hk09s9sds6",
  "cmpvdv330000jtzr0x291djgp","cmpvdv27r008sw2hk94xcdomh","cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes","cmpvdueu50047w2hktmugaati","cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];
(async () => {
  const p = new PrismaClient();
  // ScrapeJob is connected via Product.scrapeJobId
  const prods = await p.product.findMany({
    where: { id: { in: IDS } },
    select: { id: true, scrapeJob: { select: { id: true, options: true, status: true, sourceUrl: true } } },
  });
  console.log(`\nScrapeJob options for the 10 products:\n`);
  for (const pr of prods) {
    let opts: any = null;
    try { opts = JSON.parse(pr.scrapeJob?.options ?? "{}"); } catch {}
    const pricing = opts?.suggestedPricing;
    const desc = opts?.ruleToggles?.description;
    const audit = opts?.runPostScrapeAudit;
    console.log(`  pid=${pr.id} suggestedPricing=${pricing}  ruleToggles.description=${desc}  url=${(pr.scrapeJob?.sourceUrl ?? "").slice(0, 50)}`);
  }
  // Compare with default options
  const latestJob = await p.scrapeJob.findFirst({ orderBy: { createdAt: "desc" }, select: { options: true } });
  console.log(`\nLatest scrape job options snippet:`);
  try {
    const j = JSON.parse(latestJob?.options ?? "{}");
    console.log("  suggestedPricing:", j.suggestedPricing);
    console.log("  ruleToggles:", JSON.stringify(j.ruleToggles));
  } catch (e) { console.log("  parse err:", e); }
  await p.$disconnect();
})();
