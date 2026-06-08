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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq3ycad2000jw2tovgytqkld";

async function main() {
  const { applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  console.log(`Calling applyPricingToVariants("launch")...`);
  const t0 = Date.now();
  await applyPricingToVariants(PID, "launch", DEFAULT_SCRAPE_OPTIONS);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const v = await prisma.variant.findMany({
    where: { productId: PID },
    orderBy: { position: "asc" },
    select: { position: true, option1: true, price: true, compareAtPrice: true, isHidden: true },
  });
  console.log("\nFinal prices:");
  for (const x of v) {
    console.log(`  #${x.position} ${x.isHidden ? "[H]" : "[V]"} ${x.option1}: $${x.price} (compareAt=${x.compareAtPrice ?? "null"})`);
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
