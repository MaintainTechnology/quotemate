// QuoteMate · run migration 078
// (review_policy + review_threshold_inc_gst on pricing_book —
//  tradie review-before-send policy)
// Usage: node --env-file=.env.local scripts/run-migration-078.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '078_review_policy.sql')

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

async function hasIndex(client, table, name) {
  const { rows } = await client.query(
    `select 1 from pg_indexes
       where schemaname='public' and tablename=$1 and indexname=$2`,
    [table, name],
  )
  return rows.length > 0
}

async function policyDistribution(client) {
  const { rows } = await client.query(
    `select review_policy, count(*)::int as n
       from public.pricing_book
       group by review_policy
       order by review_policy nulls first`,
  )
  return rows
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforePolicy = await hasColumn(c, 'pricing_book', 'review_policy')
  const beforeThresh = await hasColumn(c, 'pricing_book', 'review_threshold_inc_gst')
  const beforePolicyChk = await hasConstraint(c, 'pricing_book_review_policy_check')
  const beforeThreshChk = await hasConstraint(c, 'pricing_book_review_threshold_check')
  const beforeIdx = await hasIndex(c, 'quotes', 'quotes_awaiting_approval_idx')
  console.log(`  before · review_policy column           ${beforePolicy ? 'present' : 'absent'}`)
  console.log(`  before · review_threshold column        ${beforeThresh ? 'present' : 'absent'}`)
  console.log(`  before · policy check constraint        ${beforePolicyChk ? 'present' : 'absent'}`)
  console.log(`  before · threshold check constraint     ${beforeThreshChk ? 'present' : 'absent'}`)
  console.log(`  before · awaiting-approval index        ${beforeIdx ? 'present' : 'absent'}`)
  if (beforePolicy) {
    const before = await policyDistribution(c)
    console.log('  before · policy distribution:')
    for (const r of before) console.log(`             ${String(r.review_policy).padEnd(24)} ${r.n}`)
  }

  console.log('\n─── executing migration 078 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterPolicy = await hasColumn(c, 'pricing_book', 'review_policy')
  const afterThresh = await hasColumn(c, 'pricing_book', 'review_threshold_inc_gst')
  const afterPolicyChk = await hasConstraint(c, 'pricing_book_review_policy_check')
  const afterThreshChk = await hasConstraint(c, 'pricing_book_review_threshold_check')
  const afterIdx = await hasIndex(c, 'quotes', 'quotes_awaiting_approval_idx')
  console.log(`  after  · review_policy column           ${afterPolicy ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · review_threshold column        ${afterThresh ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · policy check constraint        ${afterPolicyChk ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · threshold check constraint     ${afterThreshChk ? '✓ present' : '✗ MISSING'}`)
  console.log(`  after  · awaiting-approval index        ${afterIdx ? '✓ present' : '✗ MISSING'}`)

  const after = await policyDistribution(c)
  console.log('  after  · policy distribution:')
  for (const r of after) console.log(`             ${String(r.review_policy).padEnd(24)} ${r.n}`)

  // Sanity — no nulls slipped through
  const { rows: nulls } = await c.query(
    `select count(*)::int as n from public.pricing_book
      where review_policy is null or review_threshold_inc_gst is null`,
  )
  if (nulls[0].n > 0) {
    console.error(`\nABORTING: ${nulls[0].n} pricing_book row(s) still have NULL review_policy or threshold.`)
    process.exit(2)
  }

  if (!afterPolicy || !afterThresh || !afterPolicyChk || !afterThreshChk || !afterIdx) {
    console.error('\nABORTING: column, constraint, or index missing post-migration.')
    process.exit(2)
  }

  console.log('\nMigration 078 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
