// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Conversation locking migration runner (007)
//
// Usage:  node --env-file=.env.local scripts/run-conversation-locking-migration.mjs
//
// Adds processing_until + (from_number, last_message_at) index to
// sms_conversations. Idempotent (`add column if not exists`,
// `create index if not exists`).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "007_sms_conversation_locking.sql");

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

console.log("\n→ Connecting to Supabase Postgres...");
try {
  await client.connect();
  console.log("  connected.");

  console.log(`\n→ Running 007_sms_conversation_locking.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("  ✓ migration applied.");

  // Sanity probe: confirm the column + index landed.
  const colCheck = await client.query(`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sms_conversations'
      and column_name = 'processing_until'
  `);
  const idxCheck = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'sms_conversations'
      and indexname = 'sms_conversations_from_number_last_message_at_idx'
  `);

  console.log("\n  Verification:");
  console.log(`    column processing_until:    ${colCheck.rowCount > 0 ? "✓ present" : "✗ missing"}`);
  console.log(`    index on (from_number,...): ${idxCheck.rowCount > 0 ? "✓ present" : "✗ missing"}`);

  // How many existing rows would the smart-reuse logic touch?
  const countCheck = await client.query(`select count(*)::int as n from sms_conversations`);
  console.log(`\n  Existing rows: ${countCheck.rows[0].n}`);
} catch (err) {
  console.error("\n✗ migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log("\n→ Done.");
}
