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

const IDS = [
  "cmpvdwok500frw2hk9nmld4k0",
  "cmpvdvyra00dbw2hktxto64m0",
  "cmpvdvrbu00atw2hk09s9sds6",
  "cmpvdv330000jtzr0x291djgp",
  "cmpvdv27r008sw2hk94xcdomh",
  "cmpvduv67007jw2hknhvxnqwe",
  "cmpvdulx5005nw2hkaid59oes",
  "cmpvdueu50047w2hktmugaati",
  "cmpvdu7sd002zw2hkznd00mrj",
  "cmpvdtmd5001jw2hkkqjdvy5k",
];

(async () => {
  const p = new PrismaClient();

  const underServed: string[] = [];
  const rows: Array<{ id: string; expected: number; actual: number; status: string }> = [];

  for (const id of IDS) {
    // (a) Variants with non-null featuredImageId whose featuredImage exists.
    // Group by unique storagePath of featuredImage → expected hero count.
    const variants = await p.variant.findMany({
      where: { productId: id, featuredImageId: { not: null } },
      select: {
        id: true,
        featuredImageId: true,
        featuredImage: { select: { id: true, storagePath: true } },
      },
    });

    const uniqueStoragePaths = new Set<string>();
    let variantsWithExistingImage = 0;
    let variantsWithNullStoragePath = 0;
    for (const v of variants) {
      if (!v.featuredImage) continue; // referenced ProductImage missing
      variantsWithExistingImage += 1;
      if (v.featuredImage.storagePath) {
        uniqueStoragePaths.add(v.featuredImage.storagePath);
      } else {
        variantsWithNullStoragePath += 1;
      }
    }
    // Treat each variant whose featuredImage.storagePath is null as its own bucket
    // (can't dedupe by path), so add them to the expected count.
    const expected = uniqueStoragePaths.size + variantsWithNullStoragePath;

    // (b) Actual hero-flat ProductImage rows for this product.
    const actual = await p.productImage.count({
      where: { productId: id, imageType: "hero-flat" },
    });

    const status = expected > actual ? "UNDER-SERVED" : expected === actual ? "ok" : "over";
    if (expected > actual) underServed.push(id);

    rows.push({ id, expected, actual, status });
    console.log(
      `${id}  variantsWithFeaturedImg=${variants.length}  variantsWithExistingImg=${variantsWithExistingImage}  uniqueStoragePaths=${uniqueStoragePaths.size}  nullStoragePathBuckets=${variantsWithNullStoragePath}  expected=${expected}  actualHeroFlat=${actual}  ${status}`,
    );
  }

  console.log("\nSUMMARY");
  console.log("=======");
  for (const r of rows) {
    console.log(`  ${r.id}  expected=${r.expected}  actual=${r.actual}  ${r.status}`);
  }

  console.log("\nUNDER-SERVED productIds (expected > actual) — need hero regeneration:");
  if (underServed.length === 0) {
    console.log("  (none)");
  } else {
    for (const id of underServed) console.log(`  ${id}`);
  }

  console.log("\nJSON:");
  console.log(JSON.stringify({ underServed, rows }, null, 2));

  await p.$disconnect();
})();
