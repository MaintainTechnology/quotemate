// QuoteMate · run migration 071
// (add quote_display preference column to pricing_book — Phase A of the
//  itemised vs summary customer-quote display feature)
// Usage: node --env-file=.env.local scripts/run-migration-071.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '071_pricing_book_quote_display.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(client, table, col) {
  const { rows } = await client.query(
    `select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, col],
  )
  return rows.length > 0
}

async function hasConstraint(client, name) {
  const { rows } = await client.query(
    `select 1 from pg_constraint
       where conrelid = 'public.pricing_book'::regclass and conname = $1`,
    [name],
  )
  return rows.length > 0
}

async function summary(client) {
  const { rows } = await client.query(
    `select quote_display, count(*)::int as n
       from public.pricing_book
       group by quote_display
       order by quote_display nulls first`,
  )
  return rows
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeCol = await hasColumn(c, 'pricing_book', 'quote_display')
  const beforeChk = await hasConstraint(c, 'pricing_book_quote_display_check')
  console.log(`  before · quote_display column      ${beforeCol ? 'present' : 'absent'}`)
  console.log(`  before · check constraint           ${beforeChk ? 'present' : 'absent'}`)
  if (beforeCol) {
    const before = await summary(c)
    console.log('  before · distribution:')
    for (const r of before) console.log(`             ${String(r.quote_display ?? 'NULL').padEnd(10)} ${r.n}`)
  }

  console.log('\n─── executing migration 071 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterCol = await hasColumn(c, 'pricing_book', 'quote_display')
  const afterChk = await hasConstraint(c, 'pricing_book_quote_display_check')
  console.log(`  after  · quote_display column      ${afterCol ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · check constraint           ${afterChk ? '✓ present' : '✗ MISSING'}`)

  const after = await summary(c)
  console.log('  after  · distribution:')
  for (const r of after) console.log(`             ${String(r.quote_display ?? 'NULL').padEnd(10)} ${r.n}`)

  // Sanity: every existing row should now have a non-null value.
  const { rows: nulls } = await c.query(
    `select count(*)::int as n from public.pricing_book where quote_display is null`,
  )
  if (nulls[0].n > 0) {
    console.error(`\nABORTING: ${nulls[0].n} pricing_book row(s) still have NULL quote_display.`)
    process.exit(2)
  }

  if (!afterCol || !afterChk) {
    console.error('\nABORTING: column or constraint missing post-migration.')
    process.exit(2)
  }

  console.log('\nMigration 071 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
