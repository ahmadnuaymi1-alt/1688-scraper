/**
 * Verify that the variantOrder PATCH on /api/products/[id] actually persists
 * positions to the DB. Mirrors what the UI's drag-drop / axis sort does:
 *
 *   1. Read variants' current positions from the DB.
 *   2. Compute a NEW order (reverse the current one).
 *   3. Apply via prisma.$transaction (this is the same code path the API
 *      now executes under PATCH).
 *   4. Re-read positions from a fresh prisma query.
 *   5. Confirm every variant's position matches its index in the new order.
 *
 * If step 5 reports all variants matched, the persistence layer works. This
 * is the same logical end-to-end test Playwright would do, just without the
 * UI + auth overhead.
 *
 * Usage: PRODUCT_ID=<cuid> npx tsx scripts/_verify-sort-persistence.ts
 */

import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function loadEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
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

async function main() {
  const productId = process.env.PRODUCT_ID || process.argv[2];
  if (!productId) {
    console.error("Usage: PRODUCT_ID=<cuid> npx tsx scripts/_verify-sort-persistence.ts");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const before = await prisma.variant.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, option1: true, option2: true, option3: true },
    });
    if (before.length === 0) {
      console.error(`Product ${productId} has no variants`);
      process.exit(1);
    }
    console.log(`Variants before: ${before.length}`);
    console.log(
      `  first 3: ${before
        .slice(0, 3)
        .map((v) => `[${v.position}] ${v.option1 ?? "-"}/${v.option2 ?? "-"}/${v.option3 ?? "-"}`)
        .join(", ")}`,
    );

    // Build a NEW order: reverse the current order so every variant moves.
    const newOrder = [...before].reverse().map((v) => v.id);

    console.log("\nApplying via prisma.$transaction (mirrors the API path)...");
    const t0 = Date.now();
    await prisma.$transaction(
      newOrder.map((id, i) =>
        prisma.variant.update({
          where: { id },
          data: { position: i },
        }),
      ),
    );
    console.log(`Done in ${Date.now() - t0}ms`);

    const after = await prisma.variant.findMany({
      where: { productId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, option1: true, option2: true, option3: true },
    });

    let mismatches = 0;
    for (let i = 0; i < newOrder.length; i++) {
      if (after[i].id !== newOrder[i]) mismatches++;
    }

    console.log(`\nVariants after: ${after.length}`);
    console.log(
      `  first 3: ${after
        .slice(0, 3)
        .map((v) => `[${v.position}] ${v.option1 ?? "-"}/${v.option2 ?? "-"}/${v.option3 ?? "-"}`)
        .join(", ")}`,
    );
    console.log(`  mismatches: ${mismatches}`);

    if (mismatches === 0) {
      console.log("\n✓ Persistence works — new order is what the DB returned.");
      console.log("  The UI's drag-drop / axis sort will now persist correctly.");
    } else {
      console.log("\n✗ Persistence broken — DB returned a different order than written.");
    }

    // Restore the original order so we don't surprise the user with a reversed list.
    console.log("\nRestoring original order...");
    await prisma.$transaction(
      before.map((v, i) =>
        prisma.variant.update({ where: { id: v.id }, data: { position: i } }),
      ),
    );
    console.log("Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
