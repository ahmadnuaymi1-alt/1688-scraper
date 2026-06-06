/**
 * Backfill variant featured images using the size-aware do-no-harm re-derivation.
 *
 *   npx tsx scripts/_backfill-variant-images.ts                 # dry-run, all products
 *   npx tsx scripts/_backfill-variant-images.ts --product=<id>  # dry-run, one product
 *   npx tsx scripts/_backfill-variant-images.ts --apply         # APPLY to all affected
 *   npx tsx scripts/_backfill-variant-images.ts --product=<id> --apply
 *
 * Dry-run by default — prints every proposed change and writes nothing.
 */
import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const apply = process.argv.includes("--apply");
  const prodArg = process.argv.find((a) => a.startsWith("--product="));
  const onlyProduct = prodArg ? prodArg.split("=")[1] : null;

  const { prisma } = await import("../src/lib/db");
  const { computeRederivePlan, rederiveVariantFeaturedImages } = await import(
    "../src/services/variant-image-rederive.service"
  );

  const products = onlyProduct
    ? [{ id: onlyProduct, title: "" }]
    : await prisma.product.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" } });

  let totalChanges = 0;
  let changedProducts = 0;

  for (const p of products) {
    const plan = apply
      ? await rederiveVariantFeaturedImages(p.id, { apply: true })
      : await computeRederivePlan(p.id);
    if (plan.changes.length === 0) continue;
    changedProducts++;
    totalChanges += plan.changes.length;
    console.log(`\n${p.id}  (${plan.changes.length} change${plan.changes.length > 1 ? "s" : ""})`);
    for (const c of plan.changes) {
      console.log(`  • ${c.variantLabel}`);
      console.log(`      ${c.reason}`);
      console.log(`      ${c.fromImageId ?? "NULL"} → ${c.toImageId}  [${c.toOwnerLabel}]`);
    }
  }

  console.log(
    `\n${apply ? "APPLIED" : "DRY-RUN"}: ${totalChanges} change(s) across ${changedProducts} product(s).` +
      (apply ? "" : "  Re-run with --apply to write."),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
