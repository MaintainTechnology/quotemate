// Apply migration 161 — report_doc / report_style columns on quotes.
// Run: node --env-file=.env.local scripts/run-migration-161.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '161_full_quote_document.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

const COLUMNS = ['report_doc', 'report_style']
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(table, column) {
  const r = await c.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  )
  return r.rowCount > 0
}

try {
  await c.connect()
  for (const col of COLUMNS) {
    console.log(`pre-flight: quotes.${col} exists =`, await hasColumn('quotes', col))
  }
  await c.query(readFileSync(sqlPath, 'utf8'))
  console.log('migration 161 applied')
  let ok = true
  for (const col of COLUMNS) {
    const present = await hasColumn('quotes', col)
    console.log(`post-verify: quotes.${col} exists =`, present)
    if (!present) ok = false
  }
  if (!ok) {
    console.error('post-verify FAILED — a column is missing')
    process.exit(2)
  }
} catch (e) {
  console.error('migration 161 failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
