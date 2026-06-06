/**
 * Clean up LEGACY duplicate hero rows: multiple ProductImage rows (imageType
 * "hero"/"hero-flat") that share the same storagePath = the same Supabase file =
 * a true duplicate (from old hero-gen runs before storagePath idempotency).
 *
 * Per (product, storagePath) group it keeps ONE canonical row (prefer hero-flat,
 * then lowest position, then earliest), repoints any variant.featuredImageId off
 * the removed rows onto the kept row (MUST happen before delete — the relation
 * is onDelete:SetNull), then deletes the duplicates. Supabase blobs are left in
 * place (matches existing bulk-delete behavior).
 *
 *   npx tsx scripts/_dedup-hero-images.ts            # dry-run, all products
 *   npx tsx scripts/_dedup-hero-images.ts --apply    # apply
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
  const { prisma } = await import("../src/lib/db");

  const heroes = await prisma.productImage.findMany({
    where: { imageType: { in: ["hero", "hero-flat"] }, storagePath: { not: null } },
    select: { id: true, productId: true, storagePath: true, imageType: true, position: true, createdAt: true },
  });

  // group by productId + storagePath
  const groups = new Map<string, typeof heroes>();
  for (const h of heroes) {
    const k = `${h.productId}::${h.storagePath}`;
    const arr = groups.get(k) ?? [];
    arr.push(h);
    groups.set(k, arr);
  }

  const removeIds: string[] = [];
  const repoints: Array<{ fromId: string; toId: string }> = [];
  let dupGroups = 0;

  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    dupGroups++;
    // canonical: hero-flat first, then lowest position, then earliest created.
    const sorted = [...arr].sort((a, b) => {
      const af = a.imageType === "hero-flat" ? 0 : 1;
      const bf = b.imageType === "hero-flat" ? 0 : 1;
      if (af !== bf) return af - bf;
      if (a.position !== b.position) return a.position - b.position;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    const keep = sorted[0];
    for (const r of sorted.slice(1)) {
      removeIds.push(r.id);
      repoints.push({ fromId: r.id, toId: keep.id });
    }
  }

  // Which variants currently point at a row we're about to delete?
  const affectedVariants = removeIds.length
    ? await prisma.variant.findMany({
        where: { featuredImageId: { in: removeIds } },
        select: { id: true, featuredImageId: true },
      })
    : [];
  const toIdByFrom = new Map(repoints.map((r) => [r.fromId, r.toId]));

  console.log(`Duplicate hero groups: ${dupGroups}`);
  console.log(`Rows to delete: ${removeIds.length}`);
  console.log(`Variants to repoint first: ${affectedVariants.length}`);

  if (apply && removeIds.length > 0) {
    await prisma.$transaction([
      ...affectedVariants.map((v) =>
        prisma.variant.update({
          where: { id: v.id },
          data: { featuredImageId: toIdByFrom.get(v.featuredImageId!) ?? v.featuredImageId },
        }),
      ),
      prisma.productImage.deleteMany({ where: { id: { in: removeIds } } }),
    ]);
    console.log(`\nAPPLIED: repointed ${affectedVariants.length} variant(s), deleted ${removeIds.length} duplicate hero row(s).`);
  } else {
    console.log(`\nDRY-RUN: nothing written. Re-run with --apply to clean up.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
