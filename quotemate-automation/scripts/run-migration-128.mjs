// Runner for migration 128 — tenants.pricing_confirmed_at (R14 cold-start gate).
// Forward:  node --env-file=.env.local scripts/run-migration-128.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-128.mjs --rollback
//
// DDL-only migration (adds one nullable column) — no data snapshot needed:
// nothing existing is mutated (the column defaults to null on every row), and
// --rollback drops the column. Never run against prod without reviewing
// 128_tenants_pricing_confirmed_at.sql.

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
  rollback ? '128_down.sql' : '128_tenants_pricing_confirmed_at.sql',
)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set'); process.exit(1)
}

// Returns true when tenants.pricing_confirmed_at exists.
async function columnPresent(c) {
  const { rows } = await c.query(`
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenants'
       and column_name = 'pricing_confirmed_at'`)
  return rows.length > 0
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(
  `${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '128_down.sql' : '128_tenants_pricing_confirmed_at.sql'} (DDL-only, no snapshot)`,
)
try {
  await client.query('begin')
  await client.query(sql)
  const present = await columnPresent(client)
  if (rollback ? present : !present) {
    console.error(
      `\nFAIL — after ${rollback ? 'rollback' : 'apply'}, tenants.pricing_confirmed_at present=${present} (expected ${rollback ? 'false' : 'true'}).`,
    )
    await client.query('rollback')
    process.exit(1)
  }
  await client.query('commit')
  console.log(
    rollback
      ? 'done — tenants.pricing_confirmed_at dropped'
      : 'done — tenants.pricing_confirmed_at present (nullable, default null)',
  )
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
