// Safe-by-default runner for migration 226. No DB connection without --apply.
//   node --env-file=.env.local scripts/run-migration-226.mjs            dry run
//   node --env-file=.env.local scripts/run-migration-226.mjs --apply    apply and verify
//   node --env-file=.env.local scripts/run-migration-226.mjs --apply --rollback
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '226_roof_takeoff_starts_down.sql' : '226_roof_takeoff_starts.sql'
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
      where table_schema = 'public' and table_name = 'roof_takeoff_starts') as ledger_table,
    (select count(*)::int from pg_indexes
      where schemaname = 'public' and indexname = 'roof_takeoff_starts_tenant_time') as ledger_index,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'roof_takeoff_starts' and c.relrowsecurity) as ledger_rls
`
// Every start the runs hold, which the backfill must have copied once each.
const STARTS_SQL = `
  select coalesce(sum(jsonb_array_length(coalesce(usage -> 'starts', '[]'::jsonb))), 0)::int as starts
    from public.roof_takeoff_runs
`
const LEDGER_SQL = 'select count(*)::int as rows from public.roof_takeoff_starts'

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  const runs = (await client.query('select count(*)::int as runs from public.roof_takeoff_runs')).rows[0].runs
  await client.query(sql)
  const state = (await client.query(STATE_SQL)).rows[0]
  const expected = rollback ? { ledger_table: 0, ledger_index: 0, ledger_rls: 0 } : { ledger_table: 1, ledger_index: 1, ledger_rls: 1 }
  const wrong = Object.entries(expected).filter(([key, value]) => String(state[key]) !== String(value))
  let counts = {}
  if (!rollback) {
    counts = { starts: (await client.query(STARTS_SQL)).rows[0].starts, ledger: (await client.query(LEDGER_SQL)).rows[0].rows }
    if (counts.ledger !== counts.starts) wrong.push(['backfill', counts])
  }
  const after = (await client.query('select count(*)::int as runs from public.roof_takeoff_runs')).rows[0].runs
  if (wrong.length || after !== runs) {
    throw new Error(`Migration 226 ${rollback ? 'rollback ' : ''}verification failed: ${JSON.stringify({ expected, got: state, counts, runsBefore: runs, runsAfter: after })}`)
  }
  console.log('Verified', { ...state, ...counts, runs })
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
