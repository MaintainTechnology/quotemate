// QuoteMate · run migration 181 (paid_amount_cents on the trade measurement tables)
// Usage: node --env-file=.env.local scripts/run-migration-181.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '181_trade_paid_amount.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 181 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select
       count(*) filter (where table_name = 'roofing_measurements')  as roof_col,
       count(*) filter (where table_name = 'painting_measurements') as paint_col
     from information_schema.columns
      where table_schema = 'public'
        and column_name = 'paid_amount_cents'
        and table_name in ('roofing_measurements', 'painting_measurements')`,
  )
  console.log(
    `  after · roofing_measurements.paid_amount_cents=${rows[0].roof_col} ` +
      `painting_measurements.paid_amount_cents=${rows[0].paint_col}`,
  )
  if (Number(rows[0].roof_col) !== 1 || Number(rows[0].paint_col) !== 1) {
    console.error('\nABORTING: expected paid_amount_cents on BOTH trade tables after migration.')
    process.exit(2)
  }
  console.log('\nMigration 181 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
