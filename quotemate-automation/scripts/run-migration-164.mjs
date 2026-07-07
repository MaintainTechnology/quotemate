// QuoteMate · run migration 164
// (customer quote acceptance — quotes.customer_accepted_at + customer_accepted_tier)
// Usage: node --env-file=.env.local scripts/run-migration-164.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '164_quote_customer_acceptance.sql')

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
  console.log('─── executing migration 164 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasAt = await columnExists(c, 'quotes', 'customer_accepted_at')
  const hasTier = await columnExists(c, 'quotes', 'customer_accepted_tier')
  console.log(`  after · quotes.customer_accepted_at    ${hasAt}`)
  console.log(`  after · quotes.customer_accepted_tier  ${hasTier}`)

  if (!hasAt || !hasTier) {
    console.error('\nABORTING: expected both acceptance columns to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 164 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
