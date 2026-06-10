// QuoteMate · run migration 026 (WP6: quotes.price_hold_until + booking_state)
//
// SAFE BY DEFAULT. Running this WITHOUT --apply only prints the SQL and
// exits (dry run, no DB connection). This guard exists because WP6 was
// built under an explicit constraint: do NOT mutate the production
// Supabase autonomously — a human must opt in.
//
// Dry run (default, safe):
//   node --env-file=.env.local scripts/run-migration-026.mjs
// Apply for real (human-approved only):
//   node --env-file=.env.local scripts/run-migration-026.mjs --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "026_quote_hold_and_booking.sql");
const sql = readFileSync(sqlPath, "utf8");

const apply = process.argv.includes("--apply");

if (!apply) {
  console.log(
    "\nDRY RUN — migration 026 NOT applied (no --apply flag).\n" +
      "Adds quotes.price_hold_until + quotes.booking_state and backfills them.\n" +
      "Re-run with --apply ONLY after human approval:\n" +
      "  node --env-file=.env.local scripts/run-migration-026.mjs --apply\n\n" +
      `--- SQL (${sql.length.toLocaleString()} chars) ---\n${sql}`,
  );
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`\n→ Applying 026_quote_hold_and_booking.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  const { rows } = await client.query(
    `select column_name, data_type
       from information_schema.columns
      where table_name = 'quotes'
        and column_name in ('price_hold_until', 'booking_state')
      order by column_name`,
  );
  if (rows.length !== 2) {
    console.error("FAIL — expected both new columns, got:", rows);
    process.exit(1);
  }
  console.log(
    "  OK — columns present:",
    rows.map((r) => `${r.column_name}:${r.data_type}`).join(", "),
  );
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
