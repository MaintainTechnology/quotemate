// QuoteMate · run migration 108 (pylon_proposals — solar Pylon tab)
// Usage: node --env-file=.env.local scripts/run-migration-108.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '108_pylon_proposals.sql')

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
  console.log(`→ Applying 108_pylon_proposals.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const ok = await tableExists(c, 'pylon_proposals')
  console.log(`  ${ok ? '✓' : '✗'} pylon_proposals: ${ok}`)
  if (!ok) {
    console.error('POST-VERIFY FAIL: pylon_proposals missing')
    process.exit(1)
  }
  console.log('\nOK — migration 108 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
