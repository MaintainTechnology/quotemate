// QuoteMate · run migration 099 (plan_uploads + plan_extractions)
// Usage: node --env-file=.env.local scripts/run-migration-099.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '099_plan_uploads_extractions.sql')

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
  console.log(`→ Applying 099_plan_uploads_extractions.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const uploads = await tableExists(c, 'plan_uploads')
  const extractions = await tableExists(c, 'plan_extractions')
  console.log(`  ✓ plan_uploads exists: ${uploads}`)
  console.log(`  ✓ plan_extractions exists: ${extractions}`)
  if (!uploads || !extractions) {
    console.error('POST-VERIFY FAIL: expected both tables to exist')
    process.exit(1)
  }
  console.log('\nOK — migration 099 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
