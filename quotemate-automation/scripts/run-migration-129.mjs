// Runner for migration 129 — supplier_price_refs (R12 calibration provenance).
// Forward:  node --env-file=.env.local scripts/run-migration-129.mjs
// Rollback: node --env-file=.env.local scripts/run-migration-129.mjs --rollback
//
// DDL-only migration (creates one EMPTY table) — no data snapshot needed:
// nothing existing is mutated and the forward SQL seeds zero rows (the real AU
// prices are populated later by a separate verified-source calibration pass —
// flag, never fabricate). --rollback drops the table. Never run against prod
// without reviewing 129_supplier_price_refs.sql.

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
  rollback ? '129_down.sql' : '129_supplier_price_refs.sql',
)

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL not set'); process.exit(1)
}

const sql = readFileSync(sqlFile, 'utf8')
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(
  `${rollback ? 'ROLLBACK' : 'FORWARD'} — applying ${rollback ? '129_down.sql' : '129_supplier_price_refs.sql'} (DDL-only, no snapshot)`,
)
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  const { rows } = await client.query(
    rollback
      ? `select to_regclass('public.supplier_price_refs') as tbl`
      : `select count(*)::int as n from public.supplier_price_refs`,
  )
  console.log(
    rollback
      ? `done — supplier_price_refs = ${rows[0].tbl ?? 'dropped'}`
      : `done — supplier_price_refs created, ${rows[0].n} rows (empty by design — populated later by the verified-source calibration pass)`,
  )
} catch (e) {
  await client.query('rollback')
  console.error('migration failed, rolled back:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
