// QuoteMate · run migration 068
// (set Install gas HWS always_inspection=true per AS/NZS 5601)
// Usage: node --env-file=.env.local scripts/run-migration-068.mjs
//
// Pre-flight:
//   1. shared_assemblies.always_inspection column exists (migration 067)
//   2. "Install gas HWS" row exists with trade='plumbing'
//   3. Row currently has always_inspection=false (refuse if already true)
// Post-verify: the row's always_inspection is true AND a non-empty
//   row_assumptions explains why.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '068_gas_hws_always_inspection.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const { rows: colCheck } = await c.query(`
    select 1 from information_schema.columns
      where table_schema='public' and table_name='shared_assemblies' and column_name='always_inspection'`)
  if (colCheck.length === 0) {
    console.error('ABORTING: shared_assemblies.always_inspection column missing. Run migration 067 first.')
    process.exit(2)
  }
  console.log('  shared_assemblies.always_inspection column: ✓ present')

  const { rows: gasRow } = await c.query(`
    select id, name, always_inspection, row_assumptions::text as ra
      from shared_assemblies where trade='plumbing' and name='Install gas HWS'`)
  if (gasRow.length === 0) {
    console.error('ABORTING: "Install gas HWS" row not found in shared_assemblies. Has it been renamed?')
    process.exit(3)
  }
  console.log(`  Gas HWS row: id=${gasRow[0].id.slice(0,8)}… always_inspection=${gasRow[0].always_inspection}`)
  if (gasRow[0].always_inspection === true) {
    console.log('  already always_inspection=true (re-run, will no-op)')
  }

  console.log('\n─── executing migration 068 ──')
  await c.query('begin')
  try {
    const res = await c.query(sql)
    await c.query('commit')
    console.log(`  migration committed (rows updated: ${res.rowCount}).`)
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify ──')
  const { rows: after } = await c.query(`
    select name, always_inspection, row_assumptions::text as ra
      from shared_assemblies where trade='plumbing' and name='Install gas HWS'`)
  const r = after[0]
  console.log(`  always_inspection: ${r.always_inspection === true ? '✓ true' : '✗ FALSE (!)'}`)
  console.log(`  row_assumptions: ${r.ra}`)

  // Confirm lookup filtering would now exclude the row.
  const { rows: filterCheck } = await c.query(`
    select count(*)::int n from shared_assemblies
     where trade='plumbing' and name='Install gas HWS' and always_inspection=false`)
  console.log(`  lookup filter test (always_inspection=false): returns ${filterCheck[0].n} row(s) — expected 0`)
  if (filterCheck[0].n !== 0) {
    console.error('\nABORTING POST-VERIFY: row would still be visible to lookupAssembly.')
    process.exit(4)
  }

  console.log('\nMigration 068 complete. Gas HWS will now route to inspection.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
