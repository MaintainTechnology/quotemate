// QuoteMate - run migration 119 (pricing_book audit — clear malformed licence_expiry)
// Usage:
//   node --env-file=.env.local scripts/run-migration-119.mjs            # forward (clear garbage)
//   node --env-file=.env.local scripts/run-migration-119.mjs --rollback # reverse (run 119_down.sql — documented NO-OP)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '119_pricing_book_audit.sql')
const downSqlPath = join(here, '..', 'sql', 'migrations', '119_down.sql')

const rollback = process.argv.includes('--rollback')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

const sql = readFileSync(rollback ? downSqlPath : sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  if (rollback) {
    console.log(`ROLLBACK — applying 119_down.sql (${sql.length.toLocaleString()} chars)...`)
    const { rows } = await c.query(sql)
    const backup = rows?.[0]?.restore_from_backup_table ?? null
    console.log(
      `  Documented NO-OP: the licence_expiry fix is one-way; live data left unchanged.`,
    )
    console.log(
      `  True row-for-row restore source (if needed): ${backup ?? 'pricing_book_backup_mig119 (not present — never applied forward, or snapshot dropped)'}`,
    )
    console.log('\nOK - migration 119 rollback acknowledged (no data changed).')
    process.exit(0)
  }

  // FORWARD: snapshot the table BEFORE applying, so the (impossible) original
  // value can be restored if ever required (spec: Migration backup + rollback).
  // Idempotent — never overwrites an existing snapshot.
  await c.query(
    `create table if not exists pricing_book_backup_mig119 as
       select * from public.pricing_book`,
  )
  console.log('Pre-apply backup snapshot: pricing_book_backup_mig119')

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
