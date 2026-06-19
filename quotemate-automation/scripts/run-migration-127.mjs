// Runner for migration 127 — quotes observability columns (R7 + R27).
// Forward:  node --env-file=.env.local scripts/run-migration-127.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-127.mjs --rollback
//
// DDL-only migration (additive columns on public.quotes) — no data snapshot
// needed. Adding a column with a constant/NULL default does NOT rewrite
// existing rows in Postgres, so nothing existing is mutated; --rollback drops
// the three columns this migration introduced (routing_decision is retained —
// it pre-existed 127; see 127_down.sql).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const rollback = process.argv.includes('--rollback')
const here = dirname(fileURLToPath(import.meta.url))
const sqlFile = join(here, '..', 'sql', 'migrations', rollback ? '127_down.sql' : '127_quotes_pricing_path.sql')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set'); process.exit(1)
}

// Columns 127 ADDS (and the down migration drops). routing_decision is NOT
// listed: it pre-exists this migration and is intentionally left in place.
const ADDED_COLUMNS = ['pricing_path', 'auto_sent', 'grounding_result']

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(`${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '127_down.sql' : '127_quotes_pricing_path.sql'} (DDL-only column add, no snapshot)`)
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')

  const { rows } = await client.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'quotes'
        and column_name = any($1::text[])`,
    [ADDED_COLUMNS],
  )
  const present = rows.map((r) => r.column_name)
  if (rollback) {
    console.log(`done — quotes observability columns present after rollback: ${present.length ? present.join(', ') : 'none (dropped)'}`)
  } else {
    console.log(`done — quotes observability columns present: ${present.join(', ')}`)
  }
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
