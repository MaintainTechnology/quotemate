// QuoteMate · run migration 034 (WP2 completion — catalogue cost price,
// description, is_preferred).
// Usage:  node --env-file=.env.local scripts/run-migration-034.mjs
//
// Purely additive + idempotent (add column if not exists). Safe before
// OR after the code deploy. None of the three columns are read by the
// grounding validator, so this cannot regress a live quote.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "034_catalogue_cost_desc_preferred.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

// [column, expected data_type] on tenant_material_catalogue.
const EXPECTED_COLS = [
  ["cost_price_ex_gst", "numeric"],
  ["description", "text"],
  ["is_preferred", "boolean"],
];

const sql = readFileSync(sqlPath, "utf8");
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`→ Running 034_catalogue_cost_desc_preferred.sql (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  console.log("OK migration applied");

  let bad = 0;
  for (const [col, type] of EXPECTED_COLS) {
    const { rows } = await client.query(
      `select data_type
         from information_schema.columns
        where table_name = 'tenant_material_catalogue' and column_name = $1`,
      [col],
    );
    if (rows.length === 0) {
      console.error(`  ✗ MISSING COLUMN: ${col}`);
      bad++;
    } else if (!String(rows[0].data_type).startsWith(type)) {
      console.error(`  ✗ ${col} type=${rows[0].data_type} expected ${type}`);
      bad++;
    } else {
      console.log(`  ✓ ${col} (${rows[0].data_type})`);
    }
  }

  // is_preferred must be NOT NULL with a false default (idempotent backfill).
  const { rows: pref } = await client.query(
    `select is_nullable, column_default
       from information_schema.columns
      where table_name = 'tenant_material_catalogue' and column_name = 'is_preferred'`,
  );
  if (pref.length && pref[0].is_nullable !== "NO") {
    console.error("  ✗ is_preferred should be NOT NULL");
    bad++;
  } else if (pref.length) {
    console.log(`  ✓ is_preferred NOT NULL default ${pref[0].column_default}`);
  }

  if (bad > 0) {
    console.error(`\nFAIL — ${bad} problem(s).`);
    process.exit(1);
  }
  console.log("\nOK — migration 034 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
