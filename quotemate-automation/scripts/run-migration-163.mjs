// QuoteMate — run migration 163 (tenants.clerk_user_id, the Clerk link).
// Usage:
//   node --env-file=.env.local scripts/run-migration-163.mjs
//   node --env-file=.env.local scripts/run-migration-163.mjs --rollback
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const file = rollback ? '163_down.sql' : '163_tenants_clerk_user_id.sql'
const sqlPath = join(here, '..', 'sql', 'migrations', file)

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Applying ${file} (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select 1 from information_schema.columns
      where table_schema='public' and table_name='tenants' and column_name='clerk_user_id'`,
  )
  const present = rows.length > 0
  console.log(`  tenants.clerk_user_id present: ${present}`)
  if (rollback ? present : !present) {
    console.error('Unexpected column state after migration.')
    process.exit(1)
  }
  console.log(`\nOK — migration 163 ${rollback ? 'rolled back' : 'applied'}.`)
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
