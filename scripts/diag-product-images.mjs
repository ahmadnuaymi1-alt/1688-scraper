import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DIRECT_URL });
await c.connect();
const PROD = process.argv[2] || "cmp3vcmdh000zw2wggcjr65ft";

console.log("=== ALL IMAGES FOR PRODUCT ===");
const r = await c.query(
  `SELECT i.id, i.position, i."variantId", i."storagePath", i."imageType",
          v.option1, v.option2, v."isHidden"
   FROM scraper_1688."ProductImage" i
   LEFT JOIN scraper_1688."Variant" v ON v.id = i."variantId"
   WHERE i."productId" = $1
   ORDER BY i.position`,
  [PROD],
);
console.log(`Total rows: ${r.rows.length}`);
for (const row of r.rows) {
  const path = (row.storagePath || "(none)").slice(-50);
  const variantTag = row.variantId
    ? `[${row.isHidden ? "hidden" : " live "} ${row.option1 || "-"} / ${(row.option2 || "-").slice(0, 30)}]`
    : "[unlinked-gallery]";
  console.log(
    `  pos=${String(row.position).padStart(2)} type=${(row.imageType || "null").padEnd(5)} ${variantTag.padEnd(70)} ${path}`,
  );
}

console.log();
console.log("=== Unique storagePaths (file-level dedup view) ===");
const u = await c.query(
  `SELECT "storagePath", COUNT(*)::int AS rows, COUNT(DISTINCT "variantId")::int AS variants_linked
   FROM scraper_1688."ProductImage"
   WHERE "productId" = $1 AND "storagePath" IS NOT NULL
   GROUP BY "storagePath"
   ORDER BY rows DESC`,
  [PROD],
);
console.log(`Unique files: ${u.rows.length}`);
for (const row of u.rows) {
  console.log(
    `  rows=${row.rows} variants_linked=${row.variants_linked} file=${row.storagePath?.slice(-50)}`,
  );
}

console.log();
console.log("=== Variants without featuredImageId ===");
const vmissing = await c.query(
  `SELECT id, option1, option2, "isHidden", "featuredImageId" FROM scraper_1688."Variant"
   WHERE "productId" = $1 AND "featuredImageId" IS NULL
   ORDER BY position`,
  [PROD],
);
for (const v of vmissing.rows) {
  console.log(
    `  ${v.isHidden ? "[hidden]" : "[ live ]"} ${v.option1 || "-"} | ${(v.option2 || "-").slice(0, 40)} → featured=NULL`,
  );
}

console.log();
console.log("=== Variants WITH featuredImageId ===");
const vset = await c.query(
  `SELECT v.id, v.option1, v.option2, v."isHidden",
          i."storagePath", i."imageType"
   FROM scraper_1688."Variant" v
   JOIN scraper_1688."ProductImage" i ON i.id = v."featuredImageId"
   WHERE v."productId" = $1
   ORDER BY v.position`,
  [PROD],
);
for (const v of vset.rows) {
  console.log(
    `  ${v.isHidden ? "[hidden]" : "[ live ]"} ${v.option1 || "-"} | ${(v.option2 || "-").slice(0, 40)} → featured=${v.imageType || "src"} ${v.storagePath?.slice(-30)}`,
  );
}

await c.end();
