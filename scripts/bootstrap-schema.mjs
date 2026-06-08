import pg from "pg";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL not set — load .env.local first (e.g. node --env-file=.env.local).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('CREATE SCHEMA IF NOT EXISTS "scraper_1688"');
const { rows } = await client.query(
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'scraper_1688'"
);
await client.end();
console.log(rows.length ? "Schema 'scraper_1688' ready" : "Schema creation failed");
