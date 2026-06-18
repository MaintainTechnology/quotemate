// QuoteMate - run migration 119 (pricing_book audit — clear malformed licence_expiry)
// Usage: node --env-file=.env.local scripts/run-migration-119.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '119_pricing_book_audit.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  // Pre-state: how many rows carry an impossible licence_expiry year.
  const { rows: pre } = await c.query(
    `select count(*)::int as garbage
       from public.pricing_book
      where licence_expiry is not null
        and (extract(year from licence_expiry) < 1900
             or extract(year from licence_expiry) > 2100)`,
  )
  console.log(`Applying 119_pricing_book_audit.sql (${sql.length.toLocaleString()} chars)...`)
  console.log(`  malformed licence_expiry rows before: ${pre[0].garbage}`)
  await c.query(sql)
  // Post-state: must be 0.
  const { rows: post } = await c.query(
    `select count(*)::int as garbage
       from public.pricing_book
      where licence_expiry is not null
        and (extract(year from licence_expiry) < 1900
             or extract(year from licence_expiry) > 2100)`,
  )
  console.log(`  malformed licence_expiry rows after:  ${post[0].garbage}`)
  if (post[0].garbage !== 0) {
    console.error('Migration did not clear all malformed licence_expiry values.')
    process.exit(1)
  }
  console.log('\nOK - migration 119 verified.')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
