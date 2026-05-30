/**
 * Backfill missing/blank SKUs on the latest N scraped products using the
 * shared variant-aware SKU generator (src/lib/sku.ts).
 *
 *   npx tsx scripts/_backfill-sku.ts              # latest 20, dry-run
 *   npx tsx scripts/_backfill-sku.ts 20 --fix     # latest 20, apply
 *   npx tsx scripts/_backfill-sku.ts 50 --fix     # latest 50, apply
 *   npx tsx scripts/_backfill-sku.ts 20 --fix --overwrite
 *     # ALSO overwrite existing non-blank SKUs (use when you want every variant
 *     # re-generated with the new variant-relevant format)
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

async function main() {
  const args = process.argv.slice(2);
  const count = Number(args.find((a) => !a.startsWith("--"))) || 20;
  const fix = args.includes("--fix");
  const overwrite = args.includes("--overwrite");

  const { generateSkusForVariants, uniqueTagFromId } = await import("../src/lib/sku");

  const prisma = new PrismaClient();
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: count,
    include: { variants: { orderBy: { position: "asc" } } },
  });
  process.stdout.write(
    `Backfilling SKUs on ${products.length} most recent products` +
      `${fix ? " (--fix)" : " (dry-run)"}${overwrite ? " (--overwrite ON)" : ""}\n\n`,
  );

  const updates: Array<{ productId: string; variantId: string; position: number; from: string | null; to: string; options: string }> = [];

  for (const p of products) {
    const baseMap = generateSkusForVariants(p.handle, p.title, p.variants.map((v) => ({
      key: v.id,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      position: v.position,
    })));
    // Append per-variant cuid suffix for global uniqueness.
    const planned = new Map<string, string>();
    for (const v of p.variants) {
      const base = baseMap.get(v.id)!;
      planned.set(v.id, `${base}-${uniqueTagFromId(v.id)}`);
    }

    const changedRows: Array<{ pos: number; from: string | null; to: string; opts: string }> = [];
    for (const v of p.variants) {
      const next = planned.get(v.id)!;
      const cur = (v.sku ?? "").trim();
      const shouldChange = overwrite ? cur !== next : cur === "";
      if (shouldChange && next !== cur) {
        const opts = [v.option1, v.option2, v.option3].filter(Boolean).join(" | ");
        updates.push({ productId: p.id, variantId: v.id, position: v.position, from: v.sku, to: next, options: opts });
        changedRows.push({ pos: v.position, from: v.sku, to: next, opts });
      }
    }

    if (changedRows.length === 0) {
      process.stdout.write(`${p.id}  handle=${p.handle ?? "(none)"}  ✓ all ${p.variants.length} variants already OK\n`);
    } else {
      process.stdout.write(`${p.id}  handle=${p.handle ?? "(none)"}  → ${changedRows.length}/${p.variants.length} updates\n`);
      process.stdout.write(`  title: ${p.title.slice(0, 60)}\n`);
      for (const r of changedRows.slice(0, 6)) {
        process.stdout.write(`    pos ${r.pos}  "${r.from ?? ""}" → "${r.to}"   (${r.opts})\n`);
      }
      if (changedRows.length > 6) process.stdout.write(`    ... +${changedRows.length - 6} more\n`);
    }
  }

  process.stdout.write(`\n=== Summary ===\n`);
  process.stdout.write(`  Products inspected: ${products.length}\n`);
  process.stdout.write(`  Variant updates needed: ${updates.length}\n`);
  process.stdout.write(`  Distinct products affected: ${new Set(updates.map((u) => u.productId)).size}\n`);

  if (updates.length > 0 && fix) {
    // Chunk into 200-update batches to keep each $transaction reasonable.
    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK);
      await prisma.$transaction(
        slice.map((u) =>
          prisma.variant.update({
            where: { id: u.variantId },
            data: { sku: u.to },
          }),
        ),
      );
      written += slice.length;
      process.stdout.write(`\n  ✓ wrote ${written}/${updates.length}\n`);
    }
    process.stdout.write(`\nDone.\n`);
  } else if (updates.length > 0) {
    process.stdout.write(`\n(re-run with --fix to apply ${updates.length} update(s))\n`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
