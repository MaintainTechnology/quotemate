// QuoteMate · run migration 142 (pricing_book.quote_tier_mode)
// Usage: node --env-file=.env.local scripts/run-migration-142.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '142_pricing_book_quote_tier_mode.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 142_pricing_book_quote_tier_mode.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  // Verify the column exists with the expected type + default.
  const { rows: cols } = await c.query(
    `select column_name, data_type, column_default, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'pricing_book'
        and column_name = 'quote_tier_mode'`,
  )
  const colOk =
    cols.length === 1 &&
    cols[0].is_nullable === 'NO' &&
    String(cols[0].column_default ?? '').includes("'single'")

  // Verify the CHECK constraint is present.
  const { rows: cons } = await c.query(
    `select conname from pg_constraint
      where conrelid = 'public.pricing_book'::regclass
        and conname = 'pricing_book_quote_tier_mode_check'`,
  )
  const checkOk = cons.length === 1

  // Verify no row is left outside the allowed value set (backfill worked).
  const { rows: bad } = await c.query(
    `select count(*)::int as n from public.pricing_book
      where quote_tier_mode is null
         or quote_tier_mode not in ('good_better_best','single','good','better','best')`,
  )
  const dataOk = bad[0].n === 0

  console.log(`  ${colOk ? '✓' : '✗'} pricing_book.quote_tier_mode column (NOT NULL, default 'single')`)
  console.log(`  ${checkOk ? '✓' : '✗'} pricing_book_quote_tier_mode_check constraint present`)
  console.log(`  ${dataOk ? '✓' : '✗'} all rows within allowed value set (${bad[0].n} invalid)`)
  if (!colOk || !checkOk || !dataOk) process.exit(1)
  console.log('\nOK — migration 142 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
