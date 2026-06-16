// QuoteMate · run migration 115 (residential painting quote PDF —
// painting_measurements.pdf_path column).
// Usage: node --env-file=.env.local scripts/run-migration-115.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '115_painting_quote_pdf.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 115 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const present = await columnExists(c, 'painting_measurements', 'pdf_path')
  console.log(`  after · column painting_measurements.pdf_path ${present}`)
  if (!present) {
    console.error('\nABORTING: expected painting_measurements.pdf_path to exist after migration.')
    process.exit(2)
  }
  console.log('\nMigration 115 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
