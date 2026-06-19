// Runner for migration 133 — tenants.billing_exempt grandfather flag.
// Forward:  node --env-file=.env.local scripts/run-migration-133.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-133.mjs --rollback
//
// DDL-only (adds one nullable-default boolean) — no data snapshot needed.

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
  rollback ? '133_down.sql' : '133_tenants_billing_exempt.sql',
)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

async function columnPresent(c) {
  const { rows } = await c.query(`
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenants'
       and column_name = 'billing_exempt'`)
  return rows.length > 0
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(
  `${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '133_down.sql' : '133_tenants_billing_exempt.sql'} (DDL-only, no snapshot)`,
)
try {
  await client.query('begin')
  await client.query(sql)
  const present = await columnPresent(client)
  if (rollback ? present : !present) {
    console.error(
      `\nFAIL — after ${rollback ? 'rollback' : 'apply'}, tenants.billing_exempt present=${present} (expected ${rollback ? 'false' : 'true'}).`,
    )
    await client.query('rollback')
    process.exit(1)
  }
  await client.query('commit')
  console.log(
    rollback
      ? 'done — tenants.billing_exempt dropped'
      : 'done — tenants.billing_exempt present (boolean, default false)',
  )
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
