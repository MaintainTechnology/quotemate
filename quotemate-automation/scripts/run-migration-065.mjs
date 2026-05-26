// QuoteMate · run migration 065
// (lift easy-5 mustAsk into shared_assemblies.clarifying_questions)
// Usage: node --env-file=.env.local scripts/run-migration-065.mjs
//
// Phase: paired with the same-commit code change in
// lib/sms/assumptions.ts (rulesAsText now omits the MUST ASK section).
//
// Pre-flight:
//   1. Confirms exactly 16 shared_assemblies rows currently have
//      clarifying_questions IS NULL (the audit baseline). Refuses if
//      drift is bigger than ±2.
//   2. Confirms each of the 16 expected (trade, name) pairs exists
//      with NULL clarifying_questions — refuses if any row name has
//      changed or already has questions (idempotent re-run is fine —
//      it just no-ops because the WHERE includes "... AND clarifying_
//      questions is null").
// Post-verify:
//   • Same 16 rows now have non-null, array-shape clarifying_questions
//   • Total NULL count is 0 (down from 16)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '065_easy5_clarifying_questions.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

// 16 (trade, name) target pairs — must match the migration SQL exactly.
const TARGETS = [
  ['electrical', 'Install LED downlight'],
  ['electrical', 'Replace double GPO'],
  ['electrical', 'Install customer-supplied ceiling fan'],
  ['electrical', 'Supply + install AC ceiling fan'],
  ['electrical', 'Install premium DC fan with wall control'],
  ['electrical', 'Install outdoor IP-rated LED light'],
  ['electrical', 'Hardwire 240V smoke alarm'],
  ['plumbing',   'Hand rod blocked drain'],
  ['plumbing',   'Jet blast blocked drain'],
  ['plumbing',   'Install electric HWS'],
  ['plumbing',   'Install gas HWS'],
  ['plumbing',   'Install heat pump HWS'],
  ['plumbing',   'Tap replacement'],
  ['plumbing',   'Tap washer replacement'],
  ['plumbing',   'Toilet cistern repair'],
  ['plumbing',   'Toilet suite install'],
]

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  console.log('─── pre-flight: count current NULLs ──')
  const { rows: nullCount } = await c.query(
    `select count(*)::int n from shared_assemblies where clarifying_questions is null`,
  )
  console.log('  NULL clarifying_questions rows:', nullCount[0].n, '(expected 16)')
  if (Math.abs(nullCount[0].n - 16) > 2) {
    console.error('ABORTING: NULL count drifted beyond tolerance. Re-audit before running.')
    process.exit(2)
  }

  console.log('\n─── pre-flight: each target row exists ──')
  let missing = 0
  let alreadyPopulated = 0
  for (const [trade, name] of TARGETS) {
    const { rows } = await c.query(
      `select clarifying_questions is null as null_qs
         from shared_assemblies where trade = $1 and name = $2`,
      [trade, name],
    )
    if (rows.length === 0) {
      console.error(`  MISSING: (${trade}, "${name}")`)
      missing++
    } else if (!rows[0].null_qs) {
      console.log(`  already populated: (${trade}, "${name}") — will no-op`)
      alreadyPopulated++
    }
  }
  if (missing > 0) {
    console.error(`\nABORTING: ${missing} target row(s) missing. Names may have changed.`)
    process.exit(3)
  }
  console.log(`  ${TARGETS.length - alreadyPopulated} row(s) will be updated, ${alreadyPopulated} already done`)

  console.log('\n─── executing migration 065 ──')
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  console.log('\n─── post-verify ──')
  const { rows: nullAfter } = await c.query(
    `select count(*)::int n from shared_assemblies where clarifying_questions is null`,
  )
  console.log('  NULL clarifying_questions rows after:', nullAfter[0].n, '(expected 0)')

  const { rows: shape } = await c.query(`
    select trade, count(*)::int as total,
           count(*) filter (where jsonb_typeof(clarifying_questions) = 'array')::int as arr,
           avg(jsonb_array_length(clarifying_questions))::numeric(4,1) as avg_questions
      from shared_assemblies where clarifying_questions is not null
      group by trade order by trade`)
  for (const r of shape) {
    console.log(`  ${r.trade.padEnd(12)} rows=${r.total} · array-shape=${r.arr} · avg questions=${r.avg_questions}`)
  }

  console.log('\nMigration 065 complete. Paired code change (lib/sms/assumptions.ts rulesAsText) must deploy alongside.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
