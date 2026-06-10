// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Conversation slot-state migration runner (012)
//
// Usage:  node --env-file=.env.local scripts/run-conversation-state-migration.mjs
//
// Adds conversation_state JSONB column to sms_conversations.
// Idempotent (`add column if not exists`).
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "012_sms_conversation_state.sql");

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

  console.log(`\n→ Running 012_sms_conversation_state.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("  ✓ migration applied.");

  // Sanity probe: confirm the column landed with the right type + default.
  const colCheck = await client.query(`
    select column_name, data_type, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sms_conversations'
      and column_name = 'conversation_state'
  `);

  console.log("\n  Verification:");
  if (colCheck.rowCount > 0) {
    const r = colCheck.rows[0];
    console.log(`    column conversation_state: ✓ present`);
    console.log(`      data_type:    ${r.data_type}`);
    console.log(`      default:      ${r.column_default}`);
  } else {
    console.log(`    column conversation_state: ✗ missing`);
  }

  // How many existing rows will have the default empty state on next read?
  const countCheck = await client.query(`
    select
      count(*)::int as total,
      count(*) filter (where conversation_state = '{}'::jsonb)::int as empty_state
    from sms_conversations
  `);
  console.log(`\n  Existing rows: ${countCheck.rows[0].total}`);
  console.log(`  With empty conversation_state: ${countCheck.rows[0].empty_state}`);
  console.log(`  (Empty rows will be lazily populated on their next inbound webhook.)`);
} catch (err) {
  console.error("\n✗ migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
  console.log("\n→ Done.");
}
