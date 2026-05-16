/**
 * One-shot backfill: set `Variant.featuredImageId` for every variant in
 * scraper_1688 where it's currently NULL.
 *
 * Rule (matches scraper.service.ts going forward):
 *   1. Prefer a hero ProductImage linked to this variant (imageType='hero').
 *   2. Else any non-hero ProductImage linked to this variant.
 *   3. Else leave NULL.
 *
 * Idempotent — only touches rows where featuredImageId IS NULL.
 *
 * Run with:  node --env-file=.env.local scripts/backfill-featured-images.mjs
 */

import pg from "pg";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const variants = await client.query(
  `SELECT id, "productId" FROM scraper_1688."Variant" WHERE "featuredImageId" IS NULL`,
);
console.log(`Variants missing featuredImageId: ${variants.rows.length}`);

let setHero = 0;
let setSwatch = 0;
let leftNull = 0;

for (const v of variants.rows) {
  // Hero first
  const hero = await client.query(
    `SELECT id FROM scraper_1688."ProductImage"
     WHERE "variantId" = $1 AND "imageType" = 'hero'
     ORDER BY position ASC
     LIMIT 1`,
    [v.id],
  );
  let pickedId = null;
  let kind = null;
  if (hero.rowCount > 0) {
    pickedId = hero.rows[0].id;
    kind = "hero";
  } else {
    const nonHero = await client.query(
      `SELECT id FROM scraper_1688."ProductImage"
       WHERE "variantId" = $1 AND ("imageType" IS NULL OR "imageType" <> 'hero')
       ORDER BY position ASC
       LIMIT 1`,
      [v.id],
    );
    if (nonHero.rowCount > 0) {
      pickedId = nonHero.rows[0].id;
      kind = "swatch";
    }
  }

  if (!pickedId) {
    leftNull++;
    continue;
  }

  await client.query(
    `UPDATE scraper_1688."Variant" SET "featuredImageId" = $1 WHERE id = $2`,
    [pickedId, v.id],
  );
  if (kind === "hero") setHero++;
  else setSwatch++;
}

console.log(`Done. set→hero: ${setHero}  set→swatch: ${setSwatch}  left NULL: ${leftNull}`);
await client.end();
