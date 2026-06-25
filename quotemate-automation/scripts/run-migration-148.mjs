// QuoteMate · run migration 148 (refresh cached roofing PDFs for the tier-mode fix)
// Usage: node --env-file=.env.local scripts/run-migration-148.mjs
//   (or --env-file=.env.development.local to apply to the dev DB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '148_roofing_pdf_tier_mode_refresh.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  // Count how many cached roofing PDFs will be refreshed (for the log).
  const { rows: before } = await c.query(
    `select count(*)::int as n from public.roofing_measurements where pdf_path is not null`,
  )
  console.log(`→ Applying 148_roofing_pdf_tier_mode_refresh.sql (${before[0].n} cached roofing PDF(s) to refresh)...`)
  await c.query(sql)

  // Verify none remain (every cached path was nulled).
  const { rows: after } = await c.query(
    `select count(*)::int as n from public.roofing_measurements where pdf_path is not null`,
  )
  const ok = after[0].n === 0
  console.log(`  ${ok ? '✓' : '✗'} roofing_measurements.pdf_path cleared (${after[0].n} still set)`)
  if (!ok) process.exit(1)
  console.log('\nOK — migration 148 applied. Roofing PDFs regenerate lazily on next download.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
