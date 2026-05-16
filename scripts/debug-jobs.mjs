import pg from "pg";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

// All users
const users = await client.query(
  'SELECT id, email, "createdAt" FROM scraper_1688."User" ORDER BY "createdAt" DESC',
);
console.log("\n=== USERS ===");
for (const u of users.rows) console.log(`  ${u.id}  ${u.email}  ${u.createdAt.toISOString()}`);

// All jobs joined with products
const jobs = await client.query(`
  SELECT
    j.id AS job_id, j.status, j."userId" AS user_id, j."sourceUrl" AS source_url, j."errorMessage" AS err, j."createdAt" AS created,
    p.id AS product_id, p.title AS product_title
  FROM scraper_1688."ScrapeJob" j
  LEFT JOIN scraper_1688."Product" p ON p."scrapeJobId" = j.id
  ORDER BY j."createdAt" DESC
  LIMIT 30
`);
console.log("\n=== JOBS ===");
for (const j of jobs.rows) {
  const errSummary = j.err ? ` ERR=${String(j.err).slice(0, 60)}` : "";
  console.log(
    `  job=${j.job_id.slice(0, 10)} status=${j.status} user=${(j.user_id || "null").slice(0, 10)} product=${j.product_id ? j.product_id.slice(0, 10) : "NONE"}${errSummary}`,
  );
  console.log(`    title=${j.product_title || "—"} src=${j.source_url.slice(0, 80)}`);
}

await client.end();
