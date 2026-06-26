// QuoteMate · run migration 151 (painting estimate: estimate_token tradie link)
// Usage: node --env-file=.env.local scripts/run-migration-151.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '151_painting_estimate_token.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 151_painting_estimate_token.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows: cols } = await c.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public' and table_name = 'painting_measurements'
        and column_name = 'estimate_token'`,
  )
  const hasCol = cols.some((r) => r.column_name === 'estimate_token')
  const { rows: missing } = await c.query(
    `select count(*)::int as n from public.painting_measurements where estimate_token is null`,
  )
  const unbackfilled = missing[0]?.n ?? -1
  console.log(`  ${hasCol ? '✓' : '✗'} column present: estimate_token`)
  console.log(`  ${unbackfilled === 0 ? '✓' : '✗'} rows missing estimate_token: ${unbackfilled}`)
  if (!hasCol || unbackfilled !== 0) process.exit(1)
  console.log('\nOK — migration 151 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
