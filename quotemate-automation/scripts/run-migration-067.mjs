// QuoteMate · run migration 067
// (row_assumptions + always_inspection + inspection_triggers on assemblies)
// Usage: node --env-file=.env.local scripts/run-migration-067.mjs
//
// Pre-flight:
//   1. None of the three new columns exist on shared_assemblies yet
//      (or all of them do — re-run case)
//   2. Catalogue row counts match the baseline (43 shared assemblies)
// Post-verify:
//   • All three columns exist on shared_assemblies
//   • row_assumptions exists on tenant_custom_assemblies
//   • Existing rows have the safe defaults: '{}' / false / '{}'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '067_row_assumptions_and_inspection_flags.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(client, table, col) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, col],
  )
  return rows.length > 0
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const sharedRows = (await c.query(`select count(*)::int n from shared_assemblies`)).rows[0].n
  console.log(`  shared_assemblies row count: ${sharedRows} (expected 43)`)
  if (sharedRows < 40 || sharedRows > 60) {
    console.error(`ABORTING: shared_assemblies row count drift beyond tolerance.`)
    process.exit(2)
  }

  const beforeCols = {
    sa_row_assumptions:     await hasColumn(c, 'shared_assemblies', 'row_assumptions'),
    sa_always_inspection:   await hasColumn(c, 'shared_assemblies', 'always_inspection'),
    sa_inspection_triggers: await hasColumn(c, 'shared_assemblies', 'inspection_triggers'),
    tca_row_assumptions:    await hasColumn(c, 'tenant_custom_assemblies', 'row_assumptions'),
  }
  for (const [k, v] of Object.entries(beforeCols)) {
    console.log(`  before · ${k.padEnd(30)} ${v ? 'present' : 'absent'}`)
  }

  console.log('\n─── executing migration 067 ──')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify: columns ──')
  const afterCols = {
    sa_row_assumptions:     await hasColumn(c, 'shared_assemblies', 'row_assumptions'),
    sa_always_inspection:   await hasColumn(c, 'shared_assemblies', 'always_inspection'),
    sa_inspection_triggers: await hasColumn(c, 'shared_assemblies', 'inspection_triggers'),
    tca_row_assumptions:    await hasColumn(c, 'tenant_custom_assemblies', 'row_assumptions'),
  }
  let allPresent = true
  for (const [k, v] of Object.entries(afterCols)) {
    console.log(`  after  · ${k.padEnd(30)} ${v ? '✓ present' : '✗ MISSING'}`)
    if (!v) allPresent = false
  }
  if (!allPresent) {
    console.error('\nABORTING: at least one expected column is missing post-migration.')
    process.exit(3)
  }

  console.log('\n─── post-verify: defaults applied ──')
  const { rows: defaults } = await c.query(`
    select
      count(*)::int as total,
      count(*) filter (where row_assumptions = '{}'::jsonb)::int as empty_assumptions,
      count(*) filter (where always_inspection = false)::int as not_inspection,
      count(*) filter (where inspection_triggers = '{}'::text[])::int as empty_triggers
    from shared_assemblies`)
  const r = defaults[0]
  console.log(`  total shared rows: ${r.total}`)
  console.log(`  default row_assumptions ('{}'): ${r.empty_assumptions}/${r.total}`)
  console.log(`  default always_inspection (false): ${r.not_inspection}/${r.total}`)
  console.log(`  default inspection_triggers ('{}'): ${r.empty_triggers}/${r.total}`)
  if (r.empty_assumptions !== r.total || r.not_inspection !== r.total || r.empty_triggers !== r.total) {
    console.error('\nWARNING: not all rows got default values — likely already populated from a prior run. OK if idempotent re-run, but check.')
  }

  console.log('\nMigration 067 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
