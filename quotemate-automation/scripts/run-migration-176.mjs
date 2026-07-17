// QuoteMate · run migration 176
// (tenants.owner_mobile drops NOT NULL — onboarding mobile is optional;
//  a mobile-less activation stores null and skips the welcome SMS)
// Usage: node --env-file=.env.local scripts/run-migration-176.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '176_tenants_owner_mobile_optional.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log('─── executing migration 176 ──')
  await c.query(sql)
  console.log('  migration committed.')

  const { rows } = await c.query(
    `select is_nullable from information_schema.columns
      where table_schema='public' and table_name='tenants' and column_name='owner_mobile'`,
  )
  console.log(`  tenants.owner_mobile is_nullable = ${rows[0]?.is_nullable}`)
  if (rows[0]?.is_nullable !== 'YES') {
    console.error('  ✗ column is still NOT NULL — investigate')
    process.exit(1)
  }
  console.log('  ✓ verified')
} finally {
  await c.end()
}
