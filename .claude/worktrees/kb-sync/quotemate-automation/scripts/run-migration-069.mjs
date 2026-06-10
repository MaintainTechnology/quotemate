// QuoteMate · run migration 069
// (add 4 "new install" catalogue rows to shared_assemblies)
// Usage: node --env-file=.env.local scripts/run-migration-069.mjs
//
// Pre-flight:
//   1. row_assumptions + inspection_triggers columns exist (mig 067)
//   2. shared_assemblies row count is at the baseline (43 before)
//   3. None of the four new row names already exist (idempotent re-run
//      handled by the NOT EXISTS guard in the SQL)
// Post-verify:
//   • Row count is now 43 + 4 = 47
//   • Each new row has row_assumptions populated (not empty {})
//   • Each new row has clarifying_questions populated (array, not null)
//   • Each new row has inspection_triggers populated (text[], not empty)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '069_new_install_catalogue_rows.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const NEW_ROWS = [
  ['electrical', 'Install LED downlight (new install, single-storey)'],
  ['electrical', 'Hardwire 240V smoke alarm (whole-house compliance install)'],
  ['electrical', 'Install outdoor light (new circuit from indoor power)'],
  ['electrical', 'Install ceiling fan (new wiring, no existing rose)'],
]

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  console.log('─── pre-flight ──')
  for (const col of ['row_assumptions', 'inspection_triggers']) {
    const { rows } = await c.query(`
      select 1 from information_schema.columns
        where table_schema='public' and table_name='shared_assemblies' and column_name=$1`,
      [col])
    if (rows.length === 0) {
      console.error(`ABORTING: shared_assemblies.${col} column missing. Run migration 067 first.`)
      process.exit(2)
    }
    console.log(`  shared_assemblies.${col}: ✓ present`)
  }

  const beforeCount = (await c.query(`select count(*)::int n from shared_assemblies`)).rows[0].n
  console.log(`  shared_assemblies row count: ${beforeCount} (expected 43 before insert)`)

  // Check which of the 4 new rows already exist (re-run case).
  let alreadyPresent = 0
  let willInsert = 0
  for (const [trade, name] of NEW_ROWS) {
    const { rows } = await c.query(
      `select 1 from shared_assemblies where trade=$1 and name=$2`, [trade, name])
    if (rows.length > 0) { alreadyPresent++; console.log(`  already present: ${name}`) }
    else { willInsert++; console.log(`  WILL INSERT: ${name}`) }
  }
  console.log(`  → ${willInsert} new rows to insert, ${alreadyPresent} already present`)

  console.log('\n─── executing migration 069 ──')
  await c.query('begin')
  try {
    const res = await c.query(sql)
    await c.query('commit')
    console.log(`  migration committed.`)
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify ──')
  const afterCount = (await c.query(`select count(*)::int n from shared_assemblies`)).rows[0].n
  console.log(`  shared_assemblies row count: ${afterCount} (was ${beforeCount}, +${afterCount - beforeCount})`)

  for (const [trade, name] of NEW_ROWS) {
    const { rows } = await c.query(`
      select default_labour_hours, default_unit_price_ex_gst,
             row_assumptions != '{}'::jsonb as has_assumptions,
             clarifying_questions is not null and jsonb_array_length(clarifying_questions) > 0 as has_questions,
             coalesce(array_length(inspection_triggers, 1), 0) > 0 as has_triggers,
             always_inspection
        from shared_assemblies where trade=$1 and name=$2`,
      [trade, name])
    if (rows.length === 0) {
      console.error(`  ✗ ${name} MISSING after migration`)
      continue
    }
    const r = rows[0]
    const ok = r.has_assumptions && r.has_questions && r.has_triggers && r.always_inspection === false
    console.log(`  ${ok ? '✓' : '✗'} ${name}`)
    console.log(`    labour=${r.default_labour_hours}hr · price=$${r.default_unit_price_ex_gst} · assumptions=${r.has_assumptions} · questions=${r.has_questions} · triggers=${r.has_triggers} · always_inspection=${r.always_inspection}`)
  }

  console.log('\n─── catalogue coverage after migration 069 ──')
  const { rows: cov } = await c.query(`
    select category, count(*)::int as n
      from shared_assemblies where trade='electrical' and category in ('downlight','smoke_alarm','outdoor_light','fan','gpo')
      group by category order by category`)
  for (const r of cov) console.log(`  ${r.category.padEnd(14)} ${r.n} row(s)`)

  console.log('\nMigration 069 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
