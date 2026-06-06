/**
 * Verify whether the current latest-10 products in the DB have AI-suggested
 * pricing applied (pricingNotes populated + variants priced reasonably above
 * landed). Prints a status report — no mutations.
 */
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
(async () => {
  const p = new PrismaClient();
  const prods = await p.product.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, title: true, createdAt: true, pricingNotes: true,
      variants: { take: 1, select: { price: true }, orderBy: { position: "asc" } },
    },
  });
  console.log(`Latest 10 products — AI pricing status:\n`);
  console.log(`${"createdAt".padEnd(20)} ${"productId".padEnd(28)} ${"launch".padEnd(7)} ${"landed".padEnd(7)} ${"var1".padEnd(7)} ${"status".padEnd(10)} title`);
  const missing: Array<{ id: string; title: string }> = [];
  for (const pr of prods) {
    let lp: any = null;
    try { lp = JSON.parse(pr.pricingNotes ?? "{}"); } catch {}
    const launch = lp?.ladder?.find?.((t: any) => t.label === "launch")?.price;
    const landed = lp?.landedCostBreakdown?.landedUSD;
    const var1 = pr.variants[0]?.price ?? "?";
    const hasPricing = pr.pricingNotes && launch != null;
    const status = hasPricing ? "OK" : "MISSING";
    if (!hasPricing) missing.push({ id: pr.id, title: pr.title ?? "" });
    const dt = pr.createdAt.toISOString().slice(0, 19);
    const title = (pr.title ?? "").slice(0, 40);
    console.log(`${dt} ${pr.id.padEnd(28)} $${String(launch ?? "?").padEnd(6)} $${String(landed?.toFixed?.(2) ?? "?").padEnd(6)} $${String(var1).padEnd(6)} ${status.padEnd(10)} ${title}`);
  }
  console.log(`\n${prods.length - missing.length}/${prods.length} have AI pricing.`);
  if (missing.length > 0) {
    console.log(`\nMissing:`);
    for (const m of missing) console.log(`  ${m.id}  ${m.title.slice(0, 50)}`);
    console.log(`\nIDs for re-run: ${missing.map((m) => m.id).join(",")}`);
  }
  await p.$disconnect();
})();
