// Apply migration 160 — Stripe Connect payout ledger columns on quotes.
// Run: node --env-file=.env.local scripts/run-migration-160.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '160_connect_payouts.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

const COLUMNS = [
  'paid_amount_cents',
  'platform_fee_cents',
  'stripe_connect_destination',
  'completed_at',
  'stripe_payout_id',
  'payout_amount_cents',
  'payout_created_at',
]

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function hasColumn(table, column) {
  const r = await c.query(
    `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  )
  return r.rowCount > 0
}

async function hasIndex(name) {
  const r = await c.query(`select 1 from pg_indexes where schemaname='public' and indexname=$1`, [name])
  return r.rowCount > 0
}

try {
  await c.connect()

  for (const col of COLUMNS) {
    console.log(`pre-flight: quotes.${col} exists =`, await hasColumn('quotes', col))
  }

  const sql = readFileSync(sqlPath, 'utf8')
  await c.query(sql)
  console.log('migration 160 applied')

  let ok = true
  for (const col of COLUMNS) {
    const present = await hasColumn('quotes', col)
    console.log(`post-verify: quotes.${col} exists =`, present)
    if (!present) ok = false
  }
  const idx = await hasIndex('idx_quotes_connect_paid')
  console.log('post-verify: idx_quotes_connect_paid exists =', idx)
  if (!idx) ok = false

  if (!ok) {
    console.error('post-verify FAILED — a column or index is missing')
    process.exit(2)
  }

  const { rows } = await c.query(
    `select count(*)::int as connect_paid from quotes where stripe_connect_destination is not null`,
  )
  console.log('quotes already connect-routed:', rows[0].connect_paid)
} catch (e) {
  console.error('migration 160 failed:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
