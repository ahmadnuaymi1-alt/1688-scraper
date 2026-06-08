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
const PID = process.argv[2];
async function main() {
  if (!PID) throw new Error("usage: _speedtest2-pricing.ts <pid>");
  const { recalculatePricing, applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();
  let ok = false;
  for (let a = 1; a <= 4 && !ok; a++) {
    try { await recalculatePricing(PID, DEFAULT_SCRAPE_OPTIONS); ok = true; }
    catch (e) { console.log(`pricing attempt ${a} failed: ${(e as Error).message?.slice(0, 120)}`); }
  }
  if (!ok) { console.log("pricing failed 4x"); await prisma.$disconnect(); return; }
  const p = await prisma.product.findUnique({ where: { id: PID }, select: { pricingNotes: true } });
  let notes: any = p?.pricingNotes ?? null;
  if (typeof notes === "string") { try { notes = JSON.parse(notes); } catch {} }
  const tier = notes?.recommendedTier ?? notes?.recommended_tier ?? notes?.recommended?.label ?? null;
  if (!tier) { console.log("no tier"); await prisma.$disconnect(); return; }
  await applyPricingToVariants(PID, tier, DEFAULT_SCRAPE_OPTIONS);
  console.log("pricing applied tier:", tier);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
