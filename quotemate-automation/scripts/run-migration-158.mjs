// QuoteMate · run migration 158 (Canva Connect: connections + oauth states + designs)
// Usage: node --env-file=.env.local scripts/run-migration-158.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '158_canva.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`→ Applying 158_canva.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  const tables = ['canva_connections', 'canva_oauth_states', 'canva_designs']
  let allOk = true
  for (const t of tables) {
    const { rows } = await c.query(
      `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`,
      [t],
    )
    const ok = rows.length === 1
    if (!ok) allOk = false
    console.log(`  ${ok ? '✓' : '✗'} public.${t}`)
  }

  // Spot-check a few critical columns on canva_designs.
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'canva_designs'`,
  )
  const have = new Set(cols.map((r) => r.column_name))
  const required = ['id', 'tenant_id', 'canva_design_id', 'edit_url', 'status', 'png_path', 'pdf_path']
  const missing = required.filter((col) => !have.has(col))
  if (missing.length) {
    allOk = false
    console.log(`  ✗ canva_designs missing columns: ${missing.join(', ')}`)
  } else {
    console.log('  ✓ canva_designs columns present')
  }

  if (!allOk) process.exit(1)
  console.log('\nOK — migration 158 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
