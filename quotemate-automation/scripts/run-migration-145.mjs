// QuoteMate · run migration 145 (tenants.twilio_number_sid)
// Usage: node --env-file=.env.local scripts/run-migration-145.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '145_tenants_twilio_number_sid.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 145_tenants_twilio_number_sid.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows: col } = await c.query(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name = 'twilio_number_sid'`,
  )
  const haveCol = col.length === 1
  console.log(`  ${haveCol ? '✓' : '✗'} tenants.twilio_number_sid column present`)
  if (!haveCol) process.exit(1)
  console.log('\nOK — migration 145 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
