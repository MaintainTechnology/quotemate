// QuoteMate · run migration 140 (roofing measurement: measure_token + included_indices)
// Usage: node --env-file=.env.local scripts/run-migration-140.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '140_roofing_measurement_selection.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 140_roofing_measurement_selection.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows: cols } = await c.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = 'roofing_measurements'
        and column_name in ('measure_token', 'included_indices')
      order by column_name`,
  )
  const names = cols.map((r) => r.column_name)
  const hasBoth = names.includes('measure_token') && names.includes('included_indices')
  const { rows: missing } = await c.query(
    `select count(*)::int as n from public.roofing_measurements where measure_token is null`,
  )
  const unbackfilled = missing[0]?.n ?? -1
  console.log(`  ${hasBoth ? '✓' : '✗'} columns present: ${names.join(', ') || '(none)'}`)
  console.log(`  ${unbackfilled === 0 ? '✓' : '✗'} rows missing measure_token: ${unbackfilled}`)
  if (!hasBoth || unbackfilled !== 0) process.exit(1)
  console.log('\nOK — migration 140 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
