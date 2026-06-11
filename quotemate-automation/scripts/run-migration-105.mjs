// QuoteMate · run migration 105 (quote PDFs: pdf_path on quotes + roofing_measurements)
// Usage: node --env-file=.env.local scripts/run-migration-105.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '105_quote_pdfs.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
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
  console.log(`→ Applying 105_quote_pdfs.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const checks = [
    ['quotes.pdf_path', await columnExists(c, 'quotes', 'pdf_path')],
    ['roofing_measurements.pdf_path', await columnExists(c, 'roofing_measurements', 'pdf_path')],
  ]
  let allOk = true
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${ok}`)
    if (!ok) allOk = false
  }
  if (!allOk) {
    console.error('POST-VERIFY FAIL: one or more columns missing')
    process.exit(1)
  }
  console.log('\nOK — migration 105 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
