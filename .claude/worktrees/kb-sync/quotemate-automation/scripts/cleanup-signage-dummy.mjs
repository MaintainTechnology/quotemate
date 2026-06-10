// QuoteMate · clear the dummy/test signage data for a clean slate.
//
// The signage surface was built with seeded demo studios ("F45 Bondi",
// "F45 Fortitude Valley", …) + a pile of test sweeps. Now that real
// franchisors will add their own locations per brand tab, this wipes all
// studios + sweeps (and the requests / photo submissions / assessments they
// cascade to) so each brand tab starts empty. Orgs, brands and the rule
// registry are PRESERVED.
//
// Dry-run by default (prints what would be deleted). Pass --apply to execute.
//
// Usage:
//   node --env-file=.env.local scripts/cleanup-signage-dummy.mjs           # dry run
//   node --env-file=.env.local scripts/cleanup-signage-dummy.mjs --apply   # delete

import pg from 'pg'

const { Client } = pg
const APPLY = process.argv.includes('--apply')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

// Child → parent so we never strand a row behind a still-present FK. (Cascades
// would handle most of this, but being explicit keeps the intent obvious.)
const TABLES_IN_ORDER = [
  'signage_assessments',
  'signage_photo_submissions',
  'signage_requests',
  'signage_sweeps',
  'studios',
]

const PRESERVED = ['orgs', 'brands', 'signage_rules']

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function count(table) {
  const { rows } = await c.query(`select count(*)::int as n from public.${table}`)
  return rows[0].n
}

try {
  await c.connect()

  console.log(`\n${APPLY ? '⚠️  APPLY' : 'DRY RUN'} — signage dummy-data cleanup\n`)

  console.log('Will DELETE all rows in:')
  const before = {}
  for (const t of TABLES_IN_ORDER) {
    before[t] = await count(t)
    console.log(`  ${t.padEnd(30)} ${before[t]} rows`)
  }
  console.log('\nWill PRESERVE:')
  for (const t of PRESERVED) {
    console.log(`  ${t.padEnd(30)} ${await count(t)} rows`)
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to delete.')
    process.exit(0)
  }

  await c.query('begin')
  for (const t of TABLES_IN_ORDER) {
    const { rowCount } = await c.query(`delete from public.${t}`)
    console.log(`  deleted ${rowCount} from ${t}`)
  }
  await c.query('commit')

  console.log('\nAfter:')
  for (const t of TABLES_IN_ORDER) {
    console.log(`  ${t.padEnd(30)} ${await count(t)} rows`)
  }
  console.log('\nClean slate ready. Each brand tab now starts with no studios.')
} catch (e) {
  try { await c.query('rollback') } catch { /* ignore */ }
  console.error('cleanup failed:', e.message)
  process.exit(1)
} finally {
  await c.end()
}
