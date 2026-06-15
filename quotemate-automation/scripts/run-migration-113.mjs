// QuoteMate · run migration 113 (QR marketing + landing page)
// Usage: node --env-file=.env.local scripts/run-migration-113.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '113_qr_marketing.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 113_qr_marketing.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select
       exists (select 1 from information_schema.columns
         where table_schema='public' and table_name='tenants' and column_name='slug') as slug_ok,
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='marketing_qrs') as qrs_ok,
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='qr_scans') as scans_ok,
       exists (select 1 from information_schema.tables
         where table_schema='public' and table_name='lead_throttle') as throttle_ok,
       exists (select 1 from pg_proc where proname='increment_qr_scan') as scan_rpc_ok,
       exists (select 1 from pg_proc where proname='bump_lead_throttle') as throttle_rpc_ok`,
  )
  const r = rows[0]
  for (const [k, v] of Object.entries(r)) console.log(`  ${v ? '✓' : '✗'} ${k}: ${v}`)
  if (!Object.values(r).every(Boolean)) process.exit(1)
  console.log('\nOK — migration 113 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
