// QuoteMate · run migration 083
// (trade_spec_defs registry + widen tenant_material_catalogue.trade CHECK)
// Usage: node --env-file=.env.local scripts/run-migration-083.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '083_trade_spec_defs.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function tablePresent(client) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'trade_spec_defs'
     ) as present`,
  )
  return rows[0].present
}

async function tradeCheckPresent(client) {
  const { rows } = await client.query(
    `select exists (
       select 1 from pg_constraint
        where conrelid = 'public.tenant_material_catalogue'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%trade%electrical%plumbing%'
     ) as present`,
  )
  return rows[0].present
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  console.log(`  before · trade_spec_defs present       ${await tablePresent(c)}`)
  console.log(`  before · 2-trade CHECK present         ${await tradeCheckPresent(c)}`)

  console.log('\n─── executing migration 083 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const present = await tablePresent(c)
  const checkStillThere = await tradeCheckPresent(c)
  console.log(`  after  · trade_spec_defs present       ${present}`)
  console.log(`  after  · 2-trade CHECK present         ${checkStillThere}  (expect false)`)

  if (!present) {
    console.error('\nABORTING: trade_spec_defs table was not created.')
    process.exit(2)
  }
  if (checkStillThere) {
    console.error('\nWARNING: the 2-trade CHECK is still present — verify the constraint name.')
  }

  console.log('\nMigration 083 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
