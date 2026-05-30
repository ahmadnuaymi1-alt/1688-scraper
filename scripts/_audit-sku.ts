/**
 * Audit SKUs on the latest N scraped products. Reports any variant with a
 * null/empty SKU, plus per-product summary lines.
 *
 *   npx tsx scripts/_audit-sku.ts [count]
 *   npx tsx scripts/_audit-sku.ts 20 --fix
 *
 * With --fix, any variant whose sku is null/blank gets a generated default
 * (`<HANDLE>-<position+1 zero-padded>`), matching what the scraper would have
 * assigned at create time.
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

function skuPrefix(handle: string | null, productId: string): string {
  const base = (handle || productId || "PROD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 16);
  return base || "PROD";
}

function defaultSku(handle: string | null, productId: string, positionZeroIndexed: number): string {
  return `${skuPrefix(handle, productId)}-${String(positionZeroIndexed + 1).padStart(2, "0")}`;
}

async function main() {
  const args = process.argv.slice(2);
  const count = Number(args.find((a) => !a.startsWith("--"))) || 20;
  const fix = args.includes("--fix");

  const prisma = new PrismaClient();
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "desc" },
    take: count,
    include: {
      variants: { orderBy: { position: "asc" } },
    },
  });

  process.stdout.write(`Auditing SKUs on ${products.length} most recent products${fix ? " (--fix MODE)" : ""}\n\n`);

  const fixes: Array<{ productId: string; variantId: string; position: number; current: string | null; planned: string }> = [];
  let totalVariants = 0;
  let totalMissing = 0;

  for (const p of products) {
    totalVariants += p.variants.length;
    const missing = p.variants.filter((v) => !v.sku || v.sku.trim() === "");
    totalMissing += missing.length;
    const status = missing.length === 0
      ? `OK (${p.variants.length} variants, all with SKU)`
      : `⚠ ${missing.length}/${p.variants.length} variants missing SKU`;
    process.stdout.write(`${p.id}  handle=${p.handle ?? "(none)"}  ${status}\n`);
    process.stdout.write(`  title: ${p.title.slice(0, 60)}\n`);
    if (missing.length > 0) {
      for (const v of missing) {
        const planned = defaultSku(p.handle, p.id, v.position);
        fixes.push({ productId: p.id, variantId: v.id, position: v.position, current: v.sku, planned });
        process.stdout.write(`    pos ${v.position}  current="${v.sku ?? ""}"  →  planned="${planned}"  (${[v.option1, v.option2, v.option3].filter(Boolean).join(" | ")})\n`);
      }
    } else {
      // Show first 2 SKUs as a sanity check
      const sample = p.variants.slice(0, 2).map((v) => `pos${v.position}:${v.sku}`).join(" | ");
      process.stdout.write(`    sample: ${sample}\n`);
    }
  }

  process.stdout.write(`\n=== Summary ===\n`);
  process.stdout.write(`  Products inspected:   ${products.length}\n`);
  process.stdout.write(`  Variants inspected:   ${totalVariants}\n`);
  process.stdout.write(`  Variants missing SKU: ${totalMissing}\n`);
  process.stdout.write(`  Distinct products affected: ${new Set(fixes.map((f) => f.productId)).size}\n`);

  if (fixes.length > 0 && fix) {
    process.stdout.write(`\nApplying ${fixes.length} SKU update(s)...\n`);
    await prisma.$transaction(
      fixes.map((f) =>
        prisma.variant.update({
          where: { id: f.variantId },
          data: { sku: f.planned },
        }),
      ),
    );
    process.stdout.write(`✓ Done.\n`);
  } else if (fixes.length > 0) {
    process.stdout.write(`\n(re-run with --fix to apply ${fixes.length} update(s))\n`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  process.stderr.write((e instanceof Error ? e.stack ?? e.message : String(e)) + "\n");
  process.exit(1);
});
