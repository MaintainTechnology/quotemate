// QuoteMate - run migration 162 (solar requested-size ceiling 30 -> 100)
// Usage: node --env-file=.env.local scripts/run-migration-162.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '162_solar_requested_size_max_100.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Applying 162_solar_requested_size_max_100.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conname = 'solar_estimates_requested_system_kw_check'`,
  )
  const def = rows[0]?.def ?? '(constraint missing)'
  console.log(`  requested_system_kw check: ${def}`)
  if (!def.includes('100')) {
    console.error('Constraint does not bound at 100 as expected.')
    process.exit(1)
  }
  console.log('\nOK - migration 162 verified (requested_system_kw <= 100).')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
