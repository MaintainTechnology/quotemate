// QuoteMate · run migration 107 (Commercial Painting estimator —
// paint_runs, paint_rates seed, trade/doc_type/paint_run_id columns on
// plan_uploads + plan_extractions).
// Usage: node --env-file=.env.local scripts/run-migration-107.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '107_commercial_painting.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select exists (select 1 from information_schema.tables
       where table_schema='public' and table_name=$1) as present`,
    [table],
  )
  return rows[0].present
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 107 ──')
  await c.query(sql)
  console.log('  migration committed.')

  let ok = true
  for (const t of ['paint_runs', 'paint_rates']) {
    const present = await tableExists(c, t)
    console.log(`  after · table  ${t.padEnd(18)} ${present}`)
    if (!present) ok = false
  }
  for (const [t, col] of [
    ['plan_uploads', 'trade'],
    ['plan_uploads', 'doc_type'],
    ['plan_uploads', 'paint_run_id'],
    ['plan_extractions', 'trade'],
    ['plan_extractions', 'paint_run_id'],
  ]) {
    const present = await columnExists(c, t, col)
    console.log(`  after · column ${(t + '.' + col).padEnd(32)} ${present}`)
    if (!present) ok = false
  }
  const { rows } = await c.query(
    `select kind, count(*)::int as n from paint_rates
      where trade='commercial_painting' and tenant_id is null
      group by kind order by kind`,
  )
  for (const r of rows) console.log(`  seed  · ${r.kind.padEnd(10)} ${r.n} rows`)
  const total = rows.reduce((s, r) => s + r.n, 0)
  if (total < 20) {
    console.error(`\nABORTING: expected >= 20 seeded paint_rates rows, found ${total}.`)
    process.exit(2)
  }

  if (!ok) {
    console.error('\nABORTING: expected all tables/columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 107 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
