/**
 * One-shot backfill: for every Product in scraper_1688, copy each linked
 * ProductImage onto sister variants sharing the same `option1` value, so the
 * variant table shows the swatch on every color-group member.
 *
 * Idempotent — variants that already have a linked ProductImage are skipped.
 *
 * Run with:  node --env-file=.env.local scripts/backfill-swatches.mjs
 */

import pg from "pg";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const products = await client.query(
  'SELECT id, title FROM scraper_1688."Product" ORDER BY "createdAt" ASC',
);
console.log(`Found ${products.rows.length} products`);

let totalInserted = 0;

for (const p of products.rows) {
  const variants = await client.query(
    'SELECT id, option1 FROM scraper_1688."Variant" WHERE "productId" = $1',
    [p.id],
  );
  const images = await client.query(
    'SELECT id, "variantId", "sourceUrl", "storagePath", "fileName", "altText", position, width, height FROM scraper_1688."ProductImage" WHERE "productId" = $1 ORDER BY position ASC',
    [p.id],
  );

  if (images.rows.length === 0) {
    console.log(`  ${p.id.slice(0, 10)}.. ${p.title?.slice(0, 50)}: no images, skip`);
    continue;
  }

  const variantById = new Map(variants.rows.map((v) => [v.id, v]));
  const imageByOption1 = new Map();
  for (const img of images.rows) {
    if (!img.variantId) continue;
    const v = variantById.get(img.variantId);
    if (!v?.option1) continue;
    if (!imageByOption1.has(v.option1)) imageByOption1.set(v.option1, img);
  }
  if (imageByOption1.size === 0) {
    console.log(`  ${p.id.slice(0, 10)}.. ${p.title?.slice(0, 50)}: no linked swatches yet, skip`);
    continue;
  }

  const variantsWithImages = new Set(
    images.rows.filter((i) => i.variantId).map((i) => i.variantId),
  );
  const maxPos = images.rows.reduce((m, i) => (i.position > m ? i.position : m), 0);

  let nextPosition = maxPos + 1;
  const toInsert = [];
  for (const v of variants.rows) {
    if (variantsWithImages.has(v.id)) continue;
    if (!v.option1) continue;
    const sister = imageByOption1.get(v.option1);
    if (!sister) continue;
    toInsert.push({
      productId: p.id,
      variantId: v.id,
      sourceUrl: sister.sourceUrl,
      storagePath: sister.storagePath,
      fileName: sister.fileName,
      altText: sister.altText,
      position: nextPosition++,
      width: sister.width,
      height: sister.height,
    });
  }

  if (toInsert.length === 0) {
    console.log(`  ${p.id.slice(0, 10)}.. ${p.title?.slice(0, 50)}: already filled, 0 inserts`);
    continue;
  }

  // Bulk insert via parameterised values
  const placeholders = toInsert
    .map(
      (_, i) =>
        `(gen_random_uuid()::text || '_' || extract(epoch from now())::text, $${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}, 'downloaded', NOW())`,
    )
    .join(", ");
  const values = toInsert.flatMap((r) => [
    r.productId,
    r.variantId,
    r.sourceUrl,
    r.storagePath,
    r.fileName,
    r.altText,
    r.position,
    r.width,
    r.height,
  ]);
  await client.query(
    `INSERT INTO scraper_1688."ProductImage" (id, "productId", "variantId", "sourceUrl", "storagePath", "fileName", "altText", position, width, height, "downloadStatus", "createdAt") VALUES ${placeholders}`,
    values,
  );

  console.log(`  ${p.id.slice(0, 10)}.. ${p.title?.slice(0, 50)}: inserted ${toInsert.length} swatch row(s)`);
  totalInserted += toInsert.length;
}

console.log(`\nDone. Total rows inserted: ${totalInserted}`);
await client.end();
