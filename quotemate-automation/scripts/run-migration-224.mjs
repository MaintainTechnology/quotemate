// Safe-by-default runner for migration 224. No DB connection without --apply.
//   node --env-file=.env.local scripts/run-migration-224.mjs            dry run
//   node --env-file=.env.local scripts/run-migration-224.mjs --apply    apply and verify
//   node --env-file=.env.local scripts/run-migration-224.mjs --apply --rollback
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '224_roofing_measurement_request_key_down.sql' : '224_roofing_measurement_request_key.sql'
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
    (select count(*)::int from information_schema.columns
      where table_schema = 'public' and table_name = 'roofing_measurements'
        and column_name = 'source_request_key') as key_column,
    (select count(*)::int from pg_indexes
      where schemaname = 'public' and indexname = 'roofing_sms_request_key'
        and indexdef ilike '%unique%(tenant_id, source_request_key)%') as key_index
`
const ROWS_SQL = 'select count(*)::int as rows from public.roofing_measurements'

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  const before = (await client.query(ROWS_SQL)).rows[0].rows
  await client.query(sql)
  const state = { ...(await client.query(STATE_SQL)).rows[0], ...(await client.query(ROWS_SQL)).rows[0] }
  const expected = rollback ? { key_column: 0, key_index: 0 } : { key_column: 1, key_index: 1 }
  const wrong = Object.entries(expected).filter(([key, value]) => String(state[key]) !== String(value))
  if (wrong.length || state.rows !== before) {
    throw new Error(`Migration 224 ${rollback ? 'rollback ' : ''}verification failed: ${JSON.stringify({ expected, rowsBefore: before, got: state })}`)
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
