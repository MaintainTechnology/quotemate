// Apply sql/migrations/016_sms_onboarding.sql to live Supabase.
// SMS-initiated tradie onboarding foundation — conversation_type
// column + tradie_signup_intents table.
// Idempotent — re-running is a no-op.
//
// Usage:  node --env-file=.env.local scripts/run-migration-016.mjs

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "..", "sql", "migrations", "016_sms_onboarding.sql"), "utf8");

const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("→ Applying 016_sms_onboarding.sql");
await c.query(sql);
console.log("✓ Migration applied\n");

const convoCol = await c.query(`
  select column_name, data_type, column_default
    from information_schema.columns
   where table_name = 'sms_conversations' and column_name = 'conversation_type'
`);
const intentTable = await c.query(`
  select column_name, data_type
    from information_schema.columns
   where table_name = 'tradie_signup_intents'
   order by ordinal_position
`);
const idx = await c.query(`
  select indexname from pg_indexes
   where tablename = 'tradie_signup_intents'
   order by indexname
`);

console.log("── sms_conversations.conversation_type ──");
if (convoCol.rows.length === 0) {
  console.log("  ⚠ MISSING");
} else {
  const r = convoCol.rows[0];
  console.log(`  ${r.column_name}  ${r.data_type}  default=${r.column_default ?? '—'}`);
}

console.log("\n── tradie_signup_intents columns ──");
if (intentTable.rows.length === 0) {
  console.log("  ⚠ table missing");
} else {
  for (const r of intentTable.rows) console.log(`  ${r.column_name.padEnd(22)} ${r.data_type}`);
}

console.log("\n── tradie_signup_intents indexes ──");
for (const r of idx.rows) console.log(`  ${r.indexname}`);

await c.end();

const okConvo = convoCol.rows.length > 0;
const okTable = intentTable.rows.length >= 7;
const okIdx = idx.rows.some(r => r.indexname.includes('active_lookup'));

if (!okConvo || !okTable || !okIdx) {
  console.log("\n⚠ Post-migration sanity check failed");
  process.exit(1);
}
console.log("\n✓ Post-migration sanity check passed — SMS onboarding foundation is live");
