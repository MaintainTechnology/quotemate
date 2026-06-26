// QuoteMate · run migration 156
// (painting deposit flow — painting_measurements.stripe_links + paid columns)
// Usage: node --env-file=.env.local scripts/run-migration-156.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '156_painting_stripe_deposit.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name=$2
     ) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 156 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasLinks = await columnExists(c, 'painting_measurements', 'stripe_links')
  const hasPaid = await columnExists(c, 'painting_measurements', 'paid_at')
  console.log(`  after · painting_measurements.stripe_links   ${hasLinks}`)
  console.log(`  after · painting_measurements.paid_at        ${hasPaid}`)

  if (!hasLinks || !hasPaid) {
    console.error('\nABORTING: expected the new columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 156 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
