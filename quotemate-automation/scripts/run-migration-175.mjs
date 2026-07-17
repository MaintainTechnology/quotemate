// QuoteMate · run migration 175
// (customer quote five-sections: quotes.scope_short, tenant trust-video
//  columns, roofing tier-mode/display data updates)
// Usage: node --env-file=.env.local scripts/run-migration-175.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '175_customer_quote_five_sections.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
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
  console.log('─── executing migration 175 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const checks = [
    ['quotes', 'scope_short'],
    ['tenants', 'intro_video_url'],
    ['tenants', 'intro_video_path'],
    ['tenants', 'thankyou_video_url'],
    ['tenants', 'thankyou_video_path'],
  ]
  let allPresent = true
  for (const [table, col] of checks) {
    const present = await columnExists(c, table, col)
    console.log(`  after · ${table}.${col.padEnd(20)} ${present}`)
    if (!present) allPresent = false
  }

  const { rows } = await c.query(
    `select quote_tier_mode, quote_display, count(*)::int as n
       from public.pricing_book where trade = 'roofing'
      group by 1, 2`,
  )
  for (const r of rows) {
    console.log(`  roofing books · tier_mode=${r.quote_tier_mode} display=${r.quote_display} × ${r.n}`)
    if (r.quote_tier_mode !== 'single' || r.quote_display !== 'summary') allPresent = false
  }

  if (!allPresent) {
    console.error('\nABORTING: expected all five-sections columns + roofing settings after migration.')
    process.exit(2)
  }
  console.log('\nMigration 175 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
