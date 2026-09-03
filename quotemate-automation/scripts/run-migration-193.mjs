// Safe-by-default runner for migration 193. No DB connection without --apply.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const rollback = process.argv.includes('--rollback')
const apply = process.argv.includes('--apply')
const file = rollback ? '193_down.sql' : '193_quotes_inspection_cause.sql'
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
    const gone = await client.query(`
      select count(*)::int as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'quotes'
        and column_name = 'inspection_cause'
    `)
    if (gone.rows[0]?.count !== 0) {
      throw new Error('Migration 193 rollback verification failed: quotes.inspection_cause still exists')
    }
  } else {
    const verified = await client.query(`
      select data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'quotes'
        and column_name = 'inspection_cause'
    `)
    if (verified.rowCount !== 1 || verified.rows[0]?.data_type !== 'text') {
      throw new Error('Migration 193 verification failed: quotes.inspection_cause missing or not text')
    }
    // The CHECK must actually reject an unknown cause — a column without its
    // constraint would silently accept anything the app later writes.
    const constraint = await client.query(`
      select count(*)::int as count
      from pg_constraint
      where conname = 'quotes_inspection_cause_check'
    `)
    if (constraint.rows[0]?.count !== 1) {
      throw new Error('Migration 193 verification failed: quotes_inspection_cause_check missing')
    }
    console.log('Verified quotes.inspection_cause (text) + CHECK constraint')
  }
  await client.query('commit')
  console.log(`Applied and verified ${file}`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
