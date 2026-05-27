// QuoteMate · run migration 076 (Phase 7 — pipeline_traces table)
// Usage:  node --env-file=.env.local scripts/run-migration-076.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "076_pipeline_traces.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();

  console.log("\nPre-flight checks:");
  const { rows: pre } = await c.query(
    `select count(*)::int as n from information_schema.tables
     where table_schema='public' and table_name='pipeline_traces'`,
  );
  console.log(`  pipeline_traces table exists pre-apply: ${pre[0].n > 0}`);

  console.log(`\n-> Applying 076_pipeline_traces.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  console.log("\nPost-verify:");
  const { rows: cols } = await c.query(
    `select column_name, data_type from information_schema.columns
     where table_schema='public' and table_name='pipeline_traces'
     order by ordinal_position`,
  );
  if (cols.length === 0) {
    console.error("POST-VERIFY FAIL: pipeline_traces table missing after apply");
    process.exit(1);
  }
  console.table(cols);

  const { rows: idxs } = await c.query(
    `select indexname from pg_indexes
     where schemaname='public' and tablename='pipeline_traces'
     order by indexname`,
  );
  console.log(`\nIndexes (${idxs.length}):`);
  for (const i of idxs) console.log(`  - ${i.indexname}`);

  const { rows: rls } = await c.query(
    `select relrowsecurity as rls_enabled from pg_class
     where relname='pipeline_traces' and relnamespace=(
       select oid from pg_namespace where nspname='public')`,
  );
  console.log(`\nRLS enabled: ${rls[0]?.rls_enabled}`);

  // Smoke test the table accepts the expected shape.
  console.log("\nSmoke test: insert + delete a sample row");
  const ins = await c.query(`
    insert into pipeline_traces (step, substep, status, message, inputs, outputs, decisions, duration_ms)
    values ('smoke_test', 'mig_076', 'ok', 'migration runner smoke test',
            '{"hello":"world"}'::jsonb, '{"ok":true}'::jsonb,
            '{"path":"smoke"}'::jsonb, 42)
    returning id
  `);
  console.log(`  inserted id: ${ins.rows[0].id}`);
  await c.query(`delete from pipeline_traces where id = $1`, [ins.rows[0].id]);
  console.log(`  cleaned up`);

  console.log("\nOK migration 076 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
