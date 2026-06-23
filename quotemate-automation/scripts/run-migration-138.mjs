// QuoteMate · run migration 138 (tenant_feature_sources — feature toggle provenance)
// Usage: node --env-file=.env.local scripts/run-migration-138.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '138_tenant_feature_sources.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
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
  console.log(`→ Applying 138_tenant_feature_sources.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const present = await tableExists(c, 'tenant_feature_sources')
  console.log(`  ${present ? '✓' : '✗'} tenant_feature_sources: ${present}`)
  if (!present) {
    console.error('POST-VERIFY FAIL: tenant_feature_sources missing')
    process.exit(1)
  }

  const { rows } = await c.query('select count(*)::int as n from tenant_feature_sources')
  console.log(`  ✓ backfilled provenance rows: ${rows[0].n}`)
  console.log('\nOK — migration 138 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
