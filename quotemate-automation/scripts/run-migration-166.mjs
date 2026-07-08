// QuoteMate · run migration 166 (CRM connection data-centre metadata)
// Usage: node --env-file=.env.local scripts/run-migration-166.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '166_crm_connection_dc.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 166_crm_connection_dc.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows } = await c.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'crm_connections'
        and column_name = 'provider_metadata'`,
  )
  if (rows.length !== 1) {
    console.error('✗ provider_metadata column not found after migration')
    process.exit(1)
  }
  console.log(`  ✓ public.crm_connections.provider_metadata (${rows[0].data_type})`)
  console.log('\nOK — migration 166 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
