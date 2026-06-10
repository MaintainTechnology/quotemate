// QuoteMate · run migration 092 (studios location fields).
// Usage: node --env-file=.env.local scripts/run-migration-092.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '092_studios_location.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 092 ──')
  await c.query(sql)
  const { rows } = await c.query(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='studios'
        and column_name in ('address','state','postcode','street_view_url')`,
  )
  console.log(`  after · studios location columns ${rows[0].n} / 4`)
  if (rows[0].n < 4) {
    console.error('ABORTING: expected 4 location columns.')
    process.exit(2)
  }
  console.log('\nMigration 092 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
