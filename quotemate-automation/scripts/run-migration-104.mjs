// QuoteMate · run migration 104 (SMS plan estimator: toggle + plan_upload_requests + share tokens)
// Usage: node --env-file=.env.local scripts/run-migration-104.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '104_sms_plan_estimator.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name=$2
     ) as present`,
    [table, column],
  )
  return rows[0].present
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema='public' and table_name=$1
     ) as present`,
    [table],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log(`→ Applying 104_sms_plan_estimator.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const checks = [
    ['tenants.sms_estimator_enabled', await columnExists(c, 'tenants', 'sms_estimator_enabled')],
    ['plan_upload_requests', await tableExists(c, 'plan_upload_requests')],
    ['plan_uploads.source', await columnExists(c, 'plan_uploads', 'source')],
    ['plan_uploads.pdf_path', await columnExists(c, 'plan_uploads', 'pdf_path')],
    ['plan_extractions.share_token', await columnExists(c, 'plan_extractions', 'share_token')],
    ['plan_extractions.report_pdf_path', await columnExists(c, 'plan_extractions', 'report_pdf_path')],
  ]
  let allOk = true
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${ok}`)
    if (!ok) allOk = false
  }
  if (!allOk) {
    console.error('POST-VERIFY FAIL: one or more objects missing')
    process.exit(1)
  }
  console.log('\nOK — migration 104 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
