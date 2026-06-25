// QuoteMate · run migration 146 (quotes.pdf_signature)
// Usage: node --env-file=.env.local scripts/run-migration-146.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '146_quotes_pdf_signature.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 146_quotes_pdf_signature.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  // Verify the column exists with the expected (nullable text) shape.
  const { rows: cols } = await c.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes'
        and column_name = 'pdf_signature'`,
  )
  const colOk =
    cols.length === 1 && cols[0].data_type === 'text' && cols[0].is_nullable === 'YES'

  console.log(`  ${colOk ? '✓' : '✗'} quotes.pdf_signature column (nullable text)`)
  if (!colOk) process.exit(1)
  console.log('\nOK — migration 146 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
