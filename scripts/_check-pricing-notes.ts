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
  const prods = await p.product.findMany({
    where: { id: { in: IDS } },
    select: { id: true, title: true, pricingNotes: true, variants: { take: 1, select: { price: true } } },
  });
  for (const pr of prods) {
    let lp: any = null;
    try { lp = JSON.parse(pr.pricingNotes ?? "{}"); } catch {}
    const launch = lp?.ladder?.find?.((t: any) => t.label === "launch")?.price;
    const landed = lp?.landedCostBreakdown?.landedUSD;
    const firstVarPrice = pr.variants[0]?.price;
    console.log(`  ${pr.id}  pricingNotes=${pr.pricingNotes ? "YES" : "NO "}  launch=$${launch ?? "?"}  landed=$${landed?.toFixed?.(2) ?? "?"}  var1=$${firstVarPrice}  title=${(pr.title ?? "").slice(0, 40)}`);
  }
  await p.$disconnect();
})();
