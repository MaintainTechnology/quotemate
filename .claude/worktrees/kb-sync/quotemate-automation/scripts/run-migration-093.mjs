// QuoteMate · run migration 093 (studios geo: lat/lng/place_id).
// Usage: node --env-file=.env.local scripts/run-migration-093.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '093_studios_geo.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 093 ──')
  await c.query(sql)
  const { rows } = await c.query(
    `select count(*)::int as n from information_schema.columns
      where table_schema='public' and table_name='studios' and column_name in ('lat','lng','place_id')`,
  )
  console.log(`  after · studios geo columns ${rows[0].n} / 3`)
  if (rows[0].n < 3) {
    console.error('ABORTING: expected 3 geo columns.')
    process.exit(2)
  }
  console.log('\nMigration 093 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
