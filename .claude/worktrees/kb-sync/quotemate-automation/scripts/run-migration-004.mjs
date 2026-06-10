// One-shot runner for sql/migrations/004_calls_photo_request_sent_at.sql.
// Applies idempotently. Usage:
//   node --env-file=.env.local scripts/run-migration-004.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "004_calls_photo_request_sent_at.sql");
const sql = readFileSync(sqlPath, "utf8");

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`→ Applying ${sqlPath}`);
await client.query(sql);

const { rows } = await client.query(
  `select column_name, data_type
     from information_schema.columns
    where table_name='calls' and column_name='photo_request_sent_at'`
);
if (rows.length === 1) {
  console.log(`✓ Column live: calls.${rows[0].column_name} (${rows[0].data_type})`);
} else {
  console.log("✗ Column not visible after migration — investigate");
  process.exitCode = 1;
}

await client.end();
