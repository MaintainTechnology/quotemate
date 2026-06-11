// QuoteMate · run migration 102 (plan_extractions.priced_bom + priced_at)
// Usage: node --env-file=.env.local scripts/run-migration-102.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '102_plan_extraction_pricing.sql')

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

try {
  await c.connect()
  console.log(`→ Applying 102_plan_extraction_pricing.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const bom = await columnExists(c, 'plan_extractions', 'priced_bom')
  const at = await columnExists(c, 'plan_extractions', 'priced_at')
  console.log(`  ✓ plan_extractions.priced_bom exists: ${bom}`)
  console.log(`  ✓ plan_extractions.priced_at exists: ${at}`)
  if (!bom || !at) {
    console.error('POST-VERIFY FAIL: expected both columns to exist')
    process.exit(1)
  }
  console.log('\nOK — migration 102 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
