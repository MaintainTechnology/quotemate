// Safe-by-default runner for migration 228. No DB connection without --apply.
//   node --env-file=.env.local scripts/run-migration-228.mjs            dry run
//   node --env-file=.env.local scripts/run-migration-228.mjs --apply    apply and verify
//   node --env-file=.env.local scripts/run-migration-228.mjs --apply --rollback
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '228_roof_takeoff_regions_down.sql' : '228_roof_takeoff_regions.sql'
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
  select count(*)::int as regions_column
    from information_schema.columns
   where table_schema = 'public' and table_name = 'roof_takeoff_runs'
     and column_name = 'regions' and data_type = 'jsonb'
`
const RUNS_SQL = 'select count(*)::int as runs from public.roof_takeoff_runs'

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  const runs = (await client.query(RUNS_SQL)).rows[0].runs
  await client.query(sql)
  const state = (await client.query(STATE_SQL)).rows[0]
  const expected = { regions_column: rollback ? 0 : 1 }
  const after = (await client.query(RUNS_SQL)).rows[0].runs
  if (state.regions_column !== expected.regions_column || after !== runs) {
    throw new Error(`Migration 228 ${rollback ? 'rollback ' : ''}verification failed: ${JSON.stringify({ expected, got: state, runsBefore: runs, runsAfter: after })}`)
  }
  console.log('Verified', { ...state, runs })
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
