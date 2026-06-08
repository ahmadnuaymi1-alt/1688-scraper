/**
 * Agent-mode variant intelligence pass for cmq3yc012 (833685568204).
 * - Unhide all 14 variants (Phase 2 pack-axis false positive)
 * - Clear option2="Minimum 1 piece" — that's a MOQ artifact, not a real axis
 * - Set Product.optionNames = ["Design"]
 * - Set Product.productType = "watch"
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

const PRODUCT_ID = "cmq3yc012000jw2a8sm8e0sgg";

async function main() {
  const prisma = new PrismaClient();
  // Unhide all + drop pack-axis pseudo-option
  const variants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID },
    select: { id: true, position: true, option1: true, option2: true, isHidden: true },
    orderBy: { position: "asc" },
  });
  for (const v of variants) {
    await prisma.variant.update({
      where: { id: v.id },
      data: {
        isHidden: false,
        option2: null,
      },
    });
    console.log(`  v#${v.position}: hidden→false, option2→null`);
  }
  await prisma.product.update({
    where: { id: PRODUCT_ID },
    data: { optionNames: JSON.stringify(["Design"]), productType: "watch" },
  });
  console.log("Product: optionNames=[Design], productType=watch");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
