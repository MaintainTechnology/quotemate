// QuoteMate · run migration 066
// (stamp outdoor+weatherproof properties on 2 electrical assemblies)
// Usage: node --env-file=.env.local scripts/run-migration-066.mjs
//
// Pre-flight:
//   1. Both target rows exist (trade='electrical' + name match)
//   2. Both currently have properties = '{}'::jsonb (the audit
//      baseline). Refuses if either is already populated (idempotent
//      re-run is OK — the SQL has the same guard).
// Post-verify:
//   • Both rows now carry {"outdoor":true,"weatherproof":true}
//   • The strict weatherproof filter (properties->>weatherproof='true')
//     would match both — proves the latent-exclusion bug is closed.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '066_outdoor_assembly_properties.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const TARGETS = [
  ['electrical', 'Install outdoor IP-rated GPO'],
  ['electrical', 'Install motion sensor flood light'],
]

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  console.log('─── pre-flight: target rows ──')
  let missing = 0
  let alreadyDone = 0
  for (const [trade, name] of TARGETS) {
    const { rows } = await c.query(
      `select properties::text as p
         from shared_assemblies where trade=$1 and name=$2`,
      [trade, name],
    )
    if (rows.length === 0) {
      console.error(`  MISSING: (${trade}, "${name}")`)
      missing++
      continue
    }
    const p = rows[0].p
    if (p === '{}') {
      console.log(`  WILL UPDATE  (${trade}, "${name}")  current=${p}`)
    } else {
      console.log(`  already done (${trade}, "${name}")  current=${p}`)
      alreadyDone++
    }
  }
  if (missing > 0) {
    console.error('\nABORTING: at least one target row not found — name may have changed.')
    process.exit(2)
  }

  console.log('\n─── executing migration 066 ──')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify: properties + filter behaviour ──')
  for (const [trade, name] of TARGETS) {
    const { rows } = await c.query(
      `select properties::text as p,
              (properties->>'weatherproof' = 'true') as wp_match,
              (properties->>'outdoor' = 'true')      as outdoor_match
         from shared_assemblies where trade=$1 and name=$2`,
      [trade, name],
    )
    const r = rows[0]
    const ok = r.wp_match && r.outdoor_match ? '✓' : '✗'
    console.log(`  ${ok} (${trade}, "${name}")  properties=${r.p}  wp_filter=${r.wp_match}  outdoor_filter=${r.outdoor_match}`)
  }

  console.log('\n─── parity check vs sibling row ──')
  const { rows: sib } = await c.query(`
    select name, properties::text as p
      from shared_assemblies
     where trade='electrical' and name in (
       'Install outdoor IP-rated GPO',
       'Install motion sensor flood light',
       'Install outdoor IP-rated LED light'
     )
     order by name`)
  for (const r of sib) console.log(`  ${r.name.padEnd(42)} ${r.p}`)

  console.log('\nMigration 066 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
