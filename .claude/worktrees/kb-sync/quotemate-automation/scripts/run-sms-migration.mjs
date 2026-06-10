// ═══════════════════════════════════════════════════════════════════
// QuoteMate · SMS migration runner (Phase 1)
//
// Usage:  node --env-file=.env.local scripts/run-sms-migration.mjs
//
// Runs sql/migrations/002_sms_conversations.sql against Supabase.
// Idempotent — uses `create table if not exists` and
// `create index if not exists`.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "002_sms_conversations.sql");

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

console.log(`\n→ Connecting to Supabase Postgres...`);

try {
  await client.connect();
  console.log(`  connected.`);

  console.log(`\n→ Running 002_sms_conversations.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log(`  done.`);

  console.log(`\n→ Verifying tables...`);
  const checks = ["sms_conversations", "sms_messages"];
  for (const table of checks) {
    const { rows } = await client.query(
      `select count(*)::int as n from information_schema.tables
       where table_schema = 'public' and table_name = $1`,
      [table],
    );
    const exists = rows[0].n === 1;
    const mark = exists ? "✓" : "✗";
    console.log(`  ${mark} ${table.padEnd(20)} ${exists ? "exists" : "MISSING"}`);

    if (exists) {
      const { rows: r2 } = await client.query(`select count(*)::int as n from ${table}`);
      console.log(`     ${r2[0].n} row${r2[0].n === 1 ? "" : "s"}`);
    }
  }

  console.log(`\n→ Verifying indexes...`);
  const idxChecks = ["sms_conversations_from_open_idx", "sms_messages_conversation_idx"];
  for (const idx of idxChecks) {
    const { rows } = await client.query(
      `select count(*)::int as n from pg_indexes where indexname = $1`,
      [idx],
    );
    const exists = rows[0].n === 1;
    const mark = exists ? "✓" : "✗";
    console.log(`  ${mark} ${idx}`);
  }

  console.log(`\n✓ Migration complete.\n`);
} catch (err) {
  console.error(`\n✗ Migration failed:`, err.message);
  process.exit(1);
} finally {
  await client.end();
}
