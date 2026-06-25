// QuoteMate · run migration 147 (tenants.default_availability + quotes.scheduled_window)
// Usage: node --env-file=.env.local scripts/run-migration-147.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '147_tenants_default_availability.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 147_tenants_default_availability.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows: tCols } = await c.query(
    `select data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name = 'default_availability'`,
  )
  const { rows: qCols } = await c.query(
    `select data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes'
        and column_name = 'scheduled_window'`,
  )
  const tOk = tCols.length === 1 && tCols[0].data_type === 'jsonb' && tCols[0].is_nullable === 'YES'
  const qOk = qCols.length === 1 && qCols[0].data_type === 'text' && qCols[0].is_nullable === 'YES'

  console.log(`  ${tOk ? '✓' : '✗'} tenants.default_availability (nullable jsonb)`)
  console.log(`  ${qOk ? '✓' : '✗'} quotes.scheduled_window (nullable text)`)
  if (!tOk || !qOk) process.exit(1)
  console.log('\nOK — migration 147 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
