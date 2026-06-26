// Runner for migration 153 — tenant welcome-email idempotency stamp.
// Forward:  node --env-file=.env.local scripts/run-migration-153.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-153.mjs --rollback
//
// DDL-only migration (adds one nullable column + a one-shot backfill of
// already-active tenants) — no data snapshot needed: nothing existing is
// destroyed, and --rollback drops the column. Never run against prod without
// reviewing 153_tenants_welcome_email.sql.

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
  rollback ? '153_down.sql' : '153_tenants_welcome_email.sql',
)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set')
  process.exit(1)
}

// Returns true when tenants.welcome_email_sent_at exists (sentinel column).
async function columnPresent(c) {
  const { rows } = await c.query(`
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenants'
       and column_name = 'welcome_email_sent_at'`)
  return rows.length > 0
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(
  `${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '153_down.sql' : '153_tenants_welcome_email.sql'} (DDL-only, no snapshot)`,
)
try {
  await client.query('begin')
  await client.query(sql)
  const present = await columnPresent(client)
  if (rollback ? present : !present) {
    console.error(
      `\nFAIL — after ${rollback ? 'rollback' : 'apply'}, tenants.welcome_email_sent_at present=${present} (expected ${rollback ? 'false' : 'true'}).`,
    )
    await client.query('rollback')
    process.exit(1)
  }
  await client.query('commit')
  console.log(
    rollback
      ? 'done — tenants.welcome_email_sent_at dropped'
      : 'done — tenants.welcome_email_sent_at present (nullable, default null)',
  )
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
