// QuoteMate · run migration 056 (stripe_connect_state — Connect readiness flags)
//
// Apply to staging first, then production with explicit approval:
//   node --env-file=.env.staging.local scripts/run-migration-056.mjs
//   node --env-file=.env.local         scripts/run-migration-056.mjs
//
// Additive — four boolean/timestamp columns + one index on tenants.
// No data change, idempotent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "056_stripe_connect_state.sql");
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL (use --env-file=.env.local)");
  process.exit(1);
}
const target = dbUrl.includes("bobvihqwhtcbxneelfns") ? "PRODUCTION" : "staging";
const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  console.log(`→ Running 056_stripe_connect_state.sql against ${target} (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  const { rows } = await c.query(
    `select count(*)::int n from information_schema.columns
     where table_name = 'tenants'
       and column_name in ('stripe_connect_charges_enabled','stripe_connect_payouts_enabled',
                           'stripe_connect_details_submitted','stripe_connect_onboarded_at')`,
  );
  if (rows[0].n === 4) {
    console.log("  ✓ all 4 Connect-state columns present on tenants");
  } else {
    console.error(`  ✗ expected 4 Connect-state columns, found ${rows[0].n}`);
    process.exit(1);
  }
  console.log(`\nOK — migration 056 verified on ${target}.`);
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
