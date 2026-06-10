// QuoteMate · run migration 035 (WP9 — sms_conversations.product_choice).
// Usage:  node --env-file=.env.local scripts/run-migration-035.mjs
//
// Purely additive + idempotent (add column if not exists). Nothing
// reads/writes it until WP9_PRODUCT_OPTIONS is enabled, so this is safe
// before OR after the code deploy and cannot regress a conversation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "035_sms_conversation_product_choice.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`→ Running 035_sms_conversation_product_choice.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  const { rows } = await client.query(
    `select data_type
       from information_schema.columns
      where table_name = 'sms_conversations' and column_name = 'product_choice'`,
  );
  if (rows.length === 0) {
    console.error("  ✗ MISSING COLUMN: sms_conversations.product_choice");
    process.exit(1);
  }
  console.log(`  ✓ sms_conversations.product_choice (${rows[0].data_type})`);
  console.log("\nOK — migration 035 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
