// QuoteMate · run migration 098 (kb_sync_state + dirty triggers)
// Usage: node --env-file=.env.local scripts/run-migration-098.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '098_kb_sync_state.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 098_kb_sync_state.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)
  console.log('OK migration applied')

  const { rows: state } = await c.query('select count(*)::int as n from public.kb_sync_state')
  const { rows: trig } = await c.query(
    `select count(*)::int as n from pg_trigger where tgname = 'kb_sync_dirty'`,
  )
  console.log(`  ✓ kb_sync_state rows: ${state[0].n}`)
  console.log(`  ✓ kb_sync_dirty triggers attached: ${trig[0].n}`)
  if (state[0].n === 0 || trig[0].n === 0) {
    console.error('POST-VERIFY FAIL: state rows or triggers missing')
    process.exit(1)
  }
  console.log('\nOK — migration 098 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
