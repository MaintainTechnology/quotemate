// QuoteMate · run migration 152 (CRM integration + announcement email blast)
// Usage: node --env-file=.env.local scripts/run-migration-152.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '152_crm_integration.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const REQUIRED_TABLES = [
  'crm_connections',
  'crm_contacts',
  'email_campaigns',
  'email_sends',
  'email_unsubscribes',
]

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 152_crm_integration.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const { rows } = await c.query(
    `select c.relname as table_name, c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[])`,
    [REQUIRED_TABLES],
  )
  const present = new Set(rows.map((r) => r.table_name))
  let ok = true
  for (const tbl of REQUIRED_TABLES) {
    const here = present.has(tbl)
    const rls = rows.find((r) => r.table_name === tbl)?.rls
    console.log(`  ${here ? '✓' : '✗'} public.${tbl}${here ? ` (RLS ${rls ? 'on' : 'OFF'})` : ''}`)
    if (!here || !rls) ok = false
  }
  if (!ok) process.exit(1)
  console.log('\nOK — migration 152 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
