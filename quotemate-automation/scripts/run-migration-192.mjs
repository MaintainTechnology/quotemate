// Safe-by-default runner for migration 192. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '192_down.sql' : '192_ev_charger_bounds.sql'
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
  if (rollback) {
    const untouched = await client.query(`
      select count(*)::int as count
      from public.job_type_bounds
      where trade = 'electrical'
        and job_type = 'ev_charger'
        and max_labour_hours = 10.0
        and min_total_ex_gst = 400.0
        and max_total_ex_gst = 6000.0
        and per_unit_labour_hours is null
        and notes = 'PROVISIONAL_EV_CHARGER_BOUNDS_V1_2026-09-01 — confirm 10h / $400-$6,000 ex-GST with Jon before relying on this gate.'
    `)
    if (untouched.rows[0]?.count !== 0) {
      throw new Error('Migration 192 rollback verification failed: provisional row still exists')
    }
  } else {
    const verified = await client.query(`
      select
        max_labour_hours::float8 as max_labour_hours,
        min_total_ex_gst::float8 as min_total_ex_gst,
        max_total_ex_gst::float8 as max_total_ex_gst,
        notes
      from public.job_type_bounds
      where trade = 'electrical' and job_type = 'ev_charger'
    `)
    const row = verified.rows[0]
    if (
      verified.rowCount !== 1 ||
      !Number.isFinite(row?.max_labour_hours) ||
      row.max_labour_hours <= 0 ||
      !Number.isFinite(row?.min_total_ex_gst) ||
      !Number.isFinite(row?.max_total_ex_gst) ||
      row.min_total_ex_gst < 0 ||
      row.max_total_ex_gst <= row.min_total_ex_gst
    ) {
      throw new Error('Migration 192 verification failed: EV charger bounds are missing or invalid')
    }
    console.log('Verified electrical/ev_charger bounds', row)
  }
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
