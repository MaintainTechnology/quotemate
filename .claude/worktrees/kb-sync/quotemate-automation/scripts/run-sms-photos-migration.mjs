// ═══════════════════════════════════════════════════════════════════
// QuoteMate · SMS-photos migration runner (Phase 4 / photos)
//
// Usage:  node --env-file=.env.local scripts/run-sms-photos-migration.mjs
//
// Runs sql/migrations/003_sms_messages_photos.sql against Supabase.
// Idempotent — uses `add column if not exists` and `create index if not exists`.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "003_sms_messages_photos.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");

const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`\n-> Running 003_sms_messages_photos.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  // Verify the column landed
  const r = await client.query(`
    select column_name, data_type, column_default
    from information_schema.columns
    where table_name = 'sms_messages' and column_name = 'photo_urls'
  `);
  if (r.rows.length === 1) {
    const c = r.rows[0];
    console.log(`OK photo_urls column present: ${c.data_type} default ${c.column_default}`);
  } else {
    console.error("photo_urls column NOT found post-migration");
    process.exit(1);
  }
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
