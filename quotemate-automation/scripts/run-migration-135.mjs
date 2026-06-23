// QuoteMate · run migration 135 (admin_audit_log — admin customer console).
// Usage: node --env-file=.env.local scripts/run-migration-135.mjs
// Additive: creates the append-only `admin_audit_log` table with RLS on.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "135_admin_audit_log.sql");
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}
const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  console.log(`→ Running 135_admin_audit_log.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);

  const { rows } = await c.query(`
    select count(*)::int n from information_schema.tables
     where table_schema='public' and table_name='admin_audit_log'`);
  if (rows[0].n !== 1) {
    console.error("FAIL — admin_audit_log not created");
    process.exit(1);
  }
  const { rows: r2 } = await c.query(
    `select relrowsecurity from pg_class where relname = 'admin_audit_log'`,
  );
  if (!r2[0]?.relrowsecurity) {
    console.error("FAIL — RLS not enabled on admin_audit_log");
    process.exit(1);
  }
  console.log("OK — admin_audit_log table created, RLS enabled.");
  console.log("\nOK — migration 135 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
