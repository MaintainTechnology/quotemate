// QuoteMate · run migration 139 (allow 'signup' QR destination type)
// Usage: node --env-file=.env.local scripts/run-migration-139.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '139_qr_signup_destination.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 139_qr_signup_destination.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conname = 'marketing_qrs_destination_type_check'`,
  )
  const def = rows[0]?.def ?? ''
  const ok = def.includes("'signup'")
  console.log(`  ${ok ? '✓' : '✗'} constraint allows 'signup': ${def || '(constraint not found)'}`)
  if (!ok) process.exit(1)
  console.log('\nOK — migration 139 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
