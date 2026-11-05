// Safe-by-default runner for migration 223. No DB connection without --apply.
//   node --env-file=.env.local scripts/run-migration-223.mjs            dry run
//   node --env-file=.env.local scripts/run-migration-223.mjs --apply    apply and verify
//   node --env-file=.env.local scripts/run-migration-223.mjs --apply --rollback
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '223_roof_takeoff_runs_down.sql' : '223_roof_takeoff_runs.sql'
const sql = readFileSync(join(here, '..', 'sql', 'migrations', file), 'utf8')

if (!apply) {
  console.log(`DRY RUN — ${file} NOT applied. Re-run with --apply after review.\n`)
  console.log(sql)
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) throw new Error('SUPABASE_DB_URL missing')

// What the migration leaves behind, read back inside the same transaction.
const STATE_SQL = `
  select
    (select count(*)::int from information_schema.tables
      where table_schema = 'public' and table_name = 'roof_takeoff_runs') as run_table,
    (select count(*)::int from information_schema.columns
      where table_schema = 'public' and table_name = 'roof_takeoff_runs') as run_columns,
    (select relrowsecurity from pg_class
      where oid = to_regclass('public.roof_takeoff_runs')) as run_rls,
    (select count(*)::int from information_schema.columns
      where table_schema = 'public' and column_name = 'takeoff_run_id'
        and table_name in ('plan_uploads', 'plan_extractions')) as link_columns,
    (select count(*)::int from pg_indexes
      where schemaname = 'public' and indexname in (
        'roof_takeoff_runs_tenant_idx', 'roof_takeoff_runs_active_idx',
        'plan_uploads_takeoff_run_idx', 'plan_extractions_takeoff_run_idx')) as indexes,
    (select file_size_limit::bigint from storage.buckets where id = 'plan-pdfs') as bucket_limit
`

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  const state = (await client.query(STATE_SQL)).rows[0]
  const expected = rollback
    ? { run_table: 0, link_columns: 0, indexes: 0, bucket_limit: '33554432' }
    : { run_table: 1, run_columns: 26, run_rls: true, link_columns: 2, indexes: 4, bucket_limit: '52428800' }
  const wrong = Object.entries(expected).filter(([key, value]) => String(state[key]) !== String(value))
  if (wrong.length) {
    throw new Error(`Migration 223 ${rollback ? 'rollback ' : ''}verification failed: ${JSON.stringify({ expected, got: state })}`)
  }
  console.log('Verified', state)
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
