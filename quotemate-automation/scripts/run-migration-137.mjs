// QuoteMate · run migration 137 (tenant historical quotes — import batches +
// historical quote rows + tenant_file_documents.source_kind extension).
// Usage: node --env-file=.env.local scripts/run-migration-137.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '137_tenant_historical_quotes.sql')

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

try {
  await c.connect()
  console.log('─── executing migration 137 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const hasBatches = await tableExists(c, 'tenant_historical_import_batches')
  const hasQuotes = await tableExists(c, 'tenant_historical_quotes')
  console.log(`  after · tenant_historical_import_batches  ${hasBatches}`)
  console.log(`  after · tenant_historical_quotes          ${hasQuotes}`)

  // Confirm the source_kind check now admits 'historical_quote'.
  const { rows: chk } = await c.query(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conname = 'tenant_file_documents_source_kind_check'`,
  )
  const allowsHistorical = (chk[0]?.def ?? '').includes('historical_quote')
  console.log(`  after · source_kind allows historical_quote ${allowsHistorical}`)

  if (!hasBatches || !hasQuotes || !allowsHistorical) {
    console.error('\nABORTING: expected both historical tables + extended source_kind check.')
    process.exit(2)
  }
  console.log('\nMigration 137 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
