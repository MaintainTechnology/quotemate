// QuoteMate · run migration 143 (paint_runs.public_token)
// Usage: node --env-file=.env.local scripts/run-migration-143.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '143_paint_runs_public_token.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 143_paint_runs_public_token.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'paint_runs'
        and column_name = 'public_token'`,
  )
  const haveCol = cols.length === 1

  const { rows: idx } = await c.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname = 'paint_runs_public_token_idx'`,
  )
  const haveIdx = idx.length === 1

  console.log(`  ${haveCol ? '✓' : '✗'} paint_runs.public_token column present`)
  console.log(`  ${haveIdx ? '✓' : '✗'} paint_runs_public_token_idx present`)
  if (!haveCol || !haveIdx) process.exit(1)
  console.log('\nOK — migration 143 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
