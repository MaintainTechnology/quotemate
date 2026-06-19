// Runner for migration 126 — job_type_bounds (R9).
// Forward:  node --env-file=.env.local scripts/run-migration-126.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-126.mjs --rollback
//
// DDL-only migration (new table) — no data snapshot needed (nothing existing
// is mutated; --rollback drops the table). Never run against prod without
// reviewing 126_job_type_bounds.sql: the seeded bounds are PROVISIONAL and
// flagged for tradie confirmation.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const rollback = process.argv.includes('--rollback')
const here = dirname(fileURLToPath(import.meta.url))
const sqlFile = join(here, '..', 'sql', 'migrations', rollback ? '126_down.sql' : '126_job_type_bounds.sql')

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set'); process.exit(1)
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(`${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '126_down.sql' : '126_job_type_bounds.sql'} (DDL-only, no snapshot)`)
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  const { rows } = await client.query(
    rollback
      ? `select to_regclass('public.job_type_bounds') as tbl`
      : `select count(*)::int as n from public.job_type_bounds`,
  )
  console.log(rollback ? `done — job_type_bounds = ${rows[0].tbl ?? 'dropped'}` : `done — job_type_bounds has ${rows[0].n} rows`)
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
