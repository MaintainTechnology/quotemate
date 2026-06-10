// QuoteMate · run migration 090 (signage_rules.verdict_mode).
// Usage: node --env-file=.env.local scripts/run-migration-090.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '090_signage_verdict_mode.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `select exists (select 1 from information_schema.columns
       where table_schema='public' and table_name=$1 and column_name=$2) as present`,
    [table, column],
  )
  return rows[0].present
}

try {
  await c.connect()
  console.log('─── executing migration 090 ──')
  await c.query(sql)
  const present = await columnExists(c, 'signage_rules', 'verdict_mode')
  console.log(`  after · signage_rules.verdict_mode ${present}`)
  if (!present) {
    console.error('ABORTING: verdict_mode column missing after migration.')
    process.exit(2)
  }
  const { rows } = await c.query(
    `select verdict_mode, count(*)::int as n from public.signage_rules group by verdict_mode order by verdict_mode`,
  )
  console.log('  distribution:', rows.map((r) => `${r.verdict_mode}=${r.n}`).join(' '))
  console.log('\nMigration 090 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
