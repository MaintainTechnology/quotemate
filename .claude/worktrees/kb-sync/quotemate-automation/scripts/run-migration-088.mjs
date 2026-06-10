// QuoteMate · run migration 088
// (painting trade Phase 1 — shared_assemblies + shared_materials seed)
// Usage: node --env-file=.env.local scripts/run-migration-088.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '088_painting_trade_phase1.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL')
  process.exit(1)
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function rowCount(client, table, trade) {
  const { rows } = await client.query(
    `select count(*)::int as n from public.${table} where trade = $1`,
    [trade],
  )
  return rows[0].n
}

async function assemblyCategories(client) {
  const { rows } = await client.query(
    `select category, count(*)::int as n
       from public.shared_assemblies
       where trade = 'painting'
       group by category
       order by category nulls first`,
  )
  return rows
}

try {
  await c.connect()

  console.log('─── pre-flight ──')
  const beforeAsm = await rowCount(c, 'shared_assemblies', 'painting')
  const beforeMat = await rowCount(c, 'shared_materials', 'painting')
  console.log(`  before · painting assemblies           ${beforeAsm}`)
  console.log(`  before · painting materials            ${beforeMat}`)

  console.log('\n─── executing migration 088 ──')
  await c.query(sql)
  console.log('  migration committed.')

  console.log('\n─── post-verify ──')
  const afterAsm = await rowCount(c, 'shared_assemblies', 'painting')
  const afterMat = await rowCount(c, 'shared_materials', 'painting')
  console.log(`  after  · painting assemblies           ${afterAsm}`)
  console.log(`  after  · painting materials            ${afterMat}`)

  const cats = await assemblyCategories(c)
  console.log('  after  · assembly categories:')
  for (const r of cats) {
    console.log(`             ${String(r.category ?? '<null>').padEnd(24)} ${r.n}`)
  }

  if (afterAsm < 10) {
    console.error(`\nABORTING: expected ≥10 painting assemblies, found ${afterAsm}.`)
    process.exit(2)
  }
  if (afterMat < 8) {
    console.error(`\nABORTING: expected ≥8 painting materials, found ${afterMat}.`)
    process.exit(2)
  }

  console.log('\nMigration 088 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
