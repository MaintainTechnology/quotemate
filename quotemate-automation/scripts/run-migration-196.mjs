// Safe-by-default runner for migration 196. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '196_down.sql' : '196_ev_charger_clarifying_questions.sql'
const sql = readFileSync(join(here, '..', 'sql', 'migrations', file), 'utf8')

if (!apply) {
  console.log(`DRY RUN — ${file} NOT applied. Re-run with --apply after review.\n`)
  console.log(sql)
  process.exit(0)
}

const url = process.env.SUPABASE_DB_URL
if (!url) throw new Error('SUPABASE_DB_URL missing')

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})
await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  const expected = rollback ? 3 : 5
  const verified = await client.query(`
    select jsonb_array_length(coalesce(clarifying_questions, '[]'::jsonb)) as n,
           category,
           always_inspection,
           clarifying_questions
      from public.shared_assemblies
     where trade = 'electrical' and name = 'Install EV charger'
  `)
  const row = verified.rows[0]
  if (verified.rowCount !== 1) {
    throw new Error('Migration 196 verification failed: the Install EV charger row is missing')
  }
  if (Number(row?.n) !== expected) {
    throw new Error(
      `Migration 196 verification failed: expected ${expected} clarifying questions, found ${row?.n}`,
    )
  }
  // The whole SMS MUST-ASK path keys off these two, so assert them here rather
  // than discover a silent no-op in production (spec R5 / R10).
  if (String(row?.category ?? '').trim().toLowerCase() !== 'ev_charger') {
    throw new Error(
      `Migration 196 verification failed: category must be 'ev_charger', found '${row?.category}'`,
    )
  }
  if (row?.always_inspection === true) {
    throw new Error(
      'Migration 196 verification failed: always_inspection is true, so findMatchedService would skip this row',
    )
  }
  console.log(`Verified EV clarifying questions (${row.n})`, row.clarifying_questions)
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
