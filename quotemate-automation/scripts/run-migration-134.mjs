// QuoteMate · run migration 134 (per-tenant file store — tenants.file_store_id
// + tenant_file_documents tracking table).
// Usage: node --env-file=.env.local scripts/run-migration-134.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '134_tenant_file_store.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

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

try {
  await c.connect()
  console.log('─── executing migration 134 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasColumn = await columnExists(c, 'tenants', 'file_store_id')
  const hasTable = await tableExists(c, 'tenant_file_documents')
  console.log(`  after · tenants.file_store_id     ${hasColumn}`)
  console.log(`  after · tenant_file_documents     ${hasTable}`)

  if (!hasColumn || !hasTable) {
    console.error('\nABORTING: expected tenants.file_store_id + tenant_file_documents after migration.')
    process.exit(2)
  }
  console.log('\nMigration 134 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
