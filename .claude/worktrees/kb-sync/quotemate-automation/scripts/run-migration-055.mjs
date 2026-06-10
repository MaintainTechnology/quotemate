// QuoteMate · run migration 055 (activate_trade_for_tenant — §10 activation)
//
// Phase 2 — applied to the STAGING sandbox first:
//   node --env-file=.env.staging.local scripts/run-migration-055.mjs
// then to production at ship time, with explicit approval:
//   node --env-file=.env.local         scripts/run-migration-055.mjs
//
// Additive — new plpgsql function only, no schema/data change, idempotent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "055_activate_trade_for_tenant.sql");
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL (use --env-file=.env.staging.local)");
  process.exit(1);
}
const target = dbUrl.includes("bobvihqwhtcbxneelfns") ? "PRODUCTION" : "staging";
const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  console.log(`→ Running 055_activate_trade_for_tenant.sql against ${target} (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  const { rows } = await c.query(
    `select count(*)::int n from pg_proc where proname = 'activate_trade_for_tenant'`,
  );
  if (rows[0].n >= 1) {
    console.log("  ✓ function activate_trade_for_tenant present");
  } else {
    console.error("  ✗ function activate_trade_for_tenant missing");
    process.exit(1);
  }
  console.log(`\nOK — migration 055 verified on ${target}.`);
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
