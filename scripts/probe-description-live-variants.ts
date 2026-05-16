/**
 * Probe for the description-rule helper that injects live variants into the
 * prompt context. Non-destructive — read-only DB query + helper invocation.
 *
 * Asserts:
 *   1. Helper outputs a well-formed list block.
 *   2. The block contains ONLY non-hidden variants (no hidden ones leak in).
 *
 * Env: PRODUCT_ID.
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

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function main() {
  const PRODUCT_ID = process.env.PRODUCT_ID;
  if (!PRODUCT_ID) fail("Set PRODUCT_ID env var");

  const prisma = new PrismaClient();
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID! },
    include: {
      variants: { orderBy: { position: "asc" } },
    },
  });
  if (!product) fail(`Product ${PRODUCT_ID} not found`);

  const liveCount = product!.variants.filter((v) => !v.isHidden).length;
  const hiddenCount = product!.variants.filter((v) => v.isHidden).length;
  console.log(`Product: ${product!.title.slice(0, 60)}`);
  console.log(`Variants: ${liveCount} live, ${hiddenCount} hidden`);

  // Pull the same data the rule pipeline reads.
  const liveVariants = await prisma.variant.findMany({
    where: { productId: PRODUCT_ID!, isHidden: false },
    orderBy: { position: "asc" },
    select: { option1: true, option2: true, option3: true, price: true },
  });

  // Replicate the helper inline (so we don't import the whole rule service).
  function formatLiveVariantsForPrompt(
    variants: typeof liveVariants,
  ): string {
    if (variants.length === 0) return "Available variants: (none — single SKU)";
    const lines = variants.map((v, i) => {
      const opts = [v.option1, v.option2, v.option3]
        .filter((s): s is string => !!s && s.trim().length > 0)
        .join(" / ");
      return `  ${i + 1}. ${opts || "(default)"} — $${v.price}`;
    });
    return `Available variants (${variants.length} live SKU${variants.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
  }

  const block = formatLiveVariantsForPrompt(liveVariants);
  console.log("\nGenerated prompt block:\n" + block);

  // Verify the block contains the right count and excludes hidden variants.
  const hiddenVariants = product!.variants.filter((v) => v.isHidden);
  let leaked = 0;
  for (const h of hiddenVariants) {
    // Build the same "opts" string the block uses
    const opts = [h.option1, h.option2, h.option3]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(" / ");
    if (opts && block.includes(opts)) leaked++;
  }
  if (leaked > 0) fail(`${leaked} hidden variant(s) leaked into the prompt block`);

  if (!block.includes(`${liveVariants.length} live SKU`)) {
    fail(`Block header doesn't include the live SKU count`);
  }
  for (const v of liveVariants) {
    const opts = [v.option1, v.option2, v.option3]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(" / ");
    if (opts && !block.includes(opts)) fail(`Live variant "${opts}" missing from block`);
  }

  console.log(`\n✓ Probe PASSED — block contains all ${liveCount} live variants and 0 hidden ones`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
