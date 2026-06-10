// QuoteMate · run migration 079
// (quotes.followup_2h_sent_at + pricing_book.followup_2h_enabled +
//  quotes_followup_2h_pending_idx — 2-hour customer check-in cron)
// Usage: node --env-file=.env.local scripts/run-migration-079.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '079_followup_2h_checkin.sql')

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

async function hasIndex(client, table, name) {
  const { rows } = await client.query(
    `select 1 from pg_indexes
       where schemaname='public' and tablename=$1 and indexname=$2`,
    [table, name],
  )
  return rows.length > 0
}

async function enabledDistribution(client) {
  const { rows } = await client.query(
    `select followup_2h_enabled, count(*)::int as n
       from public.pricing_book
       group by followup_2h_enabled
       order by followup_2h_enabled nulls first`,
  )
  return rows
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeSentCol = await hasColumn(c, 'quotes', 'followup_2h_sent_at')
  const beforeEnabledCol = await hasColumn(c, 'pricing_book', 'followup_2h_enabled')
  const beforeIdx = await hasIndex(c, 'quotes', 'quotes_followup_2h_pending_idx')
  console.log(`  before · quotes.followup_2h_sent_at       ${beforeSentCol ? 'present' : 'absent'}`)
  console.log(`  before · pricing_book.followup_2h_enabled ${beforeEnabledCol ? 'present' : 'absent'}`)
  console.log(`  before · followup_2h_pending index        ${beforeIdx ? 'present' : 'absent'}`)
  if (beforeEnabledCol) {
    const before = await enabledDistribution(c)
    console.log('  before · enabled distribution:')
    for (const r of before) console.log(`             ${String(r.followup_2h_enabled).padEnd(8)} ${r.n}`)
  }

  console.log('\n─── executing migration 079 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterSentCol = await hasColumn(c, 'quotes', 'followup_2h_sent_at')
  const afterEnabledCol = await hasColumn(c, 'pricing_book', 'followup_2h_enabled')
  const afterIdx = await hasIndex(c, 'quotes', 'quotes_followup_2h_pending_idx')
  console.log(`  after  · quotes.followup_2h_sent_at       ${afterSentCol ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · pricing_book.followup_2h_enabled ${afterEnabledCol ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · followup_2h_pending index        ${afterIdx ? '✓ present' : '✗ MISSING'}`)

  const after = await enabledDistribution(c)
  console.log('  after  · enabled distribution:')
  for (const r of after) console.log(`             ${String(r.followup_2h_enabled).padEnd(8)} ${r.n}`)

  // Sanity — no nulls slipped through on the per-tenant flag
  const { rows: nulls } = await c.query(
    `select count(*)::int as n from public.pricing_book
      where followup_2h_enabled is null`,
  )
  if (nulls[0].n > 0) {
    console.error(`\nABORTING: ${nulls[0].n} pricing_book row(s) still have NULL followup_2h_enabled.`)
    process.exit(2)
  }

  if (!afterSentCol || !afterEnabledCol || !afterIdx) {
    console.error('\nABORTING: column or index missing post-migration.')
    process.exit(2)
  }

  console.log('\nMigration 079 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
