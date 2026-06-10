// QuoteMate · run migration 073
// (per-quote display_mode override on quotes — Phase B of the itemised
//  vs summary customer-quote display feature)
// Usage: node --env-file=.env.local scripts/run-migration-073.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '073_quotes_display_mode_override.sql')

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
       where conrelid = 'public.quotes'::regclass and conname = $1`,
    [name],
  )
  return rows.length > 0
}

async function summary(client) {
  const { rows } = await client.query(
    `select coalesce(display_mode, '__null__') as display_mode, count(*)::int as n
       from public.quotes
       group by display_mode
       order by display_mode nulls first`,
  )
  return rows
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeCol = await hasColumn(c, 'quotes', 'display_mode')
  const beforeChk = await hasConstraint(c, 'quotes_display_mode_check')
  console.log(`  before · display_mode column        ${beforeCol ? 'present' : 'absent'}`)
  console.log(`  before · check constraint            ${beforeChk ? 'present' : 'absent'}`)
  if (beforeCol) {
    const before = await summary(c)
    console.log('  before · distribution:')
    for (const r of before) console.log(`             ${String(r.display_mode).padEnd(10)} ${r.n}`)
  }

  console.log('\n─── executing migration 073 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterCol = await hasColumn(c, 'quotes', 'display_mode')
  const afterChk = await hasConstraint(c, 'quotes_display_mode_check')
  console.log(`  after  · display_mode column        ${afterCol ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · check constraint            ${afterChk ? '✓ present' : '✗ MISSING'}`)

  const after = await summary(c)
  console.log('  after  · distribution (__null__ = inherits tenant preference):')
  for (const r of after) console.log(`             ${String(r.display_mode).padEnd(10)} ${r.n}`)

  // Sanity: every existing quote must end up with NULL or one of the two
  // valid modes — the check constraint enforces this, but assert from
  // the runner too so a malformed migration is caught.
  const { rows: bad } = await c.query(
    `select count(*)::int as n
       from public.quotes
       where display_mode is not null
         and display_mode not in ('itemised', 'summary')`,
  )
  if (bad[0].n > 0) {
    console.error(`\nABORTING: ${bad[0].n} quote(s) have an invalid display_mode.`)
    process.exit(2)
  }

  if (!afterCol || !afterChk) {
    console.error('\nABORTING: column or constraint missing post-migration.')
    process.exit(2)
  }

  console.log('\nMigration 073 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
