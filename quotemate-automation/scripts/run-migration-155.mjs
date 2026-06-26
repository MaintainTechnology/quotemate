// QuoteMate · run migration 155 (register dashboard-activatable job trades)
// Usage: node --env-file=.env.local scripts/run-migration-155.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '155_register_activatable_trades.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

const TARGET = ['electrical', 'plumbing', 'painting', 'solar', 'commercial_painting']

try {
  await c.connect()
  console.log(`→ Applying 155_register_activatable_trades.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  const { rows } = await c.query(
    `select t.name,
            t.active,
            t.is_job_based,
            exists(select 1 from trade_pricing_defaults d where d.trade_id = t.id) as has_defaults
       from trades t
      where t.name = any($1::text[])
      order by t.name`,
    [TARGET],
  )
  const byName = new Map(rows.map((r) => [r.name, r]))
  let ok = true
  for (const name of TARGET) {
    const r = byName.get(name)
    const good = r && r.active && r.is_job_based && r.has_defaults
    if (!good) ok = false
    console.log(
      `  ${good ? '✓' : '✗'} ${name}: active=${r?.active ?? '—'} job_based=${r?.is_job_based ?? '—'} has_defaults=${r?.has_defaults ?? '—'}`,
    )
  }
  if (!ok) process.exit(1)
  console.log('\nOK — migration 155 verified (all 5 trades activatable).')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
