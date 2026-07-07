// QuoteMate · run migration 165
// (roofing site-visit payment + customer acceptance columns)
// Usage: node --env-file=.env.local scripts/run-migration-165.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '165_roofing_sitevisit_and_acceptance.sql')

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
  console.log('─── executing migration 165 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const roofPaid = await columnExists(c, 'roofing_measurements', 'paid_at')
  const roofAcc = await columnExists(c, 'roofing_measurements', 'customer_accepted_at')
  const paintAcc = await columnExists(c, 'painting_measurements', 'customer_accepted_at')
  console.log(`  after · roofing_measurements.paid_at              ${roofPaid}`)
  console.log(`  after · roofing_measurements.customer_accepted_at ${roofAcc}`)
  console.log(`  after · painting_measurements.customer_accepted_at ${paintAcc}`)

  if (!roofPaid || !roofAcc || !paintAcc) {
    console.error('\nABORTING: expected all acceptance/payment columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 165 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
