// Runner for migration 132 — tenant subscription / billing columns.
// Forward:  node --env-file=.env.local scripts/run-migration-132.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-132.mjs --rollback
//
// DDL-only migration (adds nullable columns + indexes) — no data snapshot
// needed: nothing existing is mutated, and --rollback drops the columns.
// Never run against prod without reviewing 132_tenants_subscription.sql.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const rollback = process.argv.includes('--rollback')
const here = dirname(fileURLToPath(import.meta.url))
const sqlFile = join(
  here,
  '..',
  'sql',
  'migrations',
  rollback ? '132_down.sql' : '132_tenants_subscription.sql',
)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

// Returns true when tenants.stripe_customer_id exists (sentinel column).
async function columnPresent(c) {
  const { rows } = await c.query(`
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenants'
       and column_name = 'stripe_customer_id'`)
  return rows.length > 0
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(
  `${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '132_down.sql' : '132_tenants_subscription.sql'} (DDL-only, no snapshot)`,
)
try {
  await client.query('begin')
  await client.query(sql)
  const present = await columnPresent(client)
  if (rollback ? present : !present) {
    console.error(
      `\nFAIL — after ${rollback ? 'rollback' : 'apply'}, tenants.stripe_customer_id present=${present} (expected ${rollback ? 'false' : 'true'}).`,
    )
    await client.query('rollback')
    process.exit(1)
  }
  await client.query('commit')
  console.log(
    rollback
      ? 'done — tenant subscription columns dropped'
      : 'done — tenant subscription columns present (nullable, default null)',
  )
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
