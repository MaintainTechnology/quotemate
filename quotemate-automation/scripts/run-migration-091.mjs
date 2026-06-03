// QuoteMate · run migration 091 (brands table).
// Usage: node --env-file=.env.local scripts/run-migration-091.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '091_brands.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 091 ──')
  await c.query(sql)
  const { rows } = await c.query(
    `select exists (select 1 from information_schema.tables
       where table_schema='public' and table_name='brands') as present`,
  )
  console.log(`  after · brands table present ${rows[0].present}`)
  if (!rows[0].present) {
    console.error('ABORTING: brands table missing after migration.')
    process.exit(2)
  }
  console.log('\nMigration 091 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
