/**
 * Step 8.5b: Apply already-recommended pricing tier "launch" for cmq3ydo0l000jw288ns3doet5.
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
    const v = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const PID = "cmq3ydo0l000jw288ns3doet5";

async function main() {
  const { applyPricingToVariants } = await import("../src/services/pricing.service");
  const { DEFAULT_SCRAPE_OPTIONS } = await import("../src/types/scrape-options");
  const prisma = new PrismaClient();

  const tier = "launch";
  console.log(`\n=== applyPricingToVariants(${PID}, "${tier}") ===`);
  const t1 = Date.now();
  await applyPricingToVariants(PID, tier, DEFAULT_SCRAPE_OPTIONS);
  console.log(`applyPricingToVariants done in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const after = await prisma.product.findUnique({
    where: { id: PID },
    select: {
      variants: {
        where: { isHidden: false },
        orderBy: { position: "asc" },
        select: { position: true, option1: true, price: true, compareAtPrice: true },
      },
    },
  });
  console.log("\nFinal variant prices (visible only):");
  for (const v of after?.variants ?? []) {
    console.log(`  [${v.position}] ${v.option1}: $${v.price} (compareAt=${v.compareAtPrice ?? "null"})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
