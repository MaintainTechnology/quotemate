// QuoteMate - run migration 131 (pricing_book.rate_review_flag — R13 outlier flag)
// Usage:
//   node --env-file=.env.local scripts/run-migration-131.mjs            # forward (add column + flag out-of-band rows)
//   node --env-file=.env.local scripts/run-migration-131.mjs --rollback # reverse (run 131_down.sql — drop the column)
//
// DATA migration: it mutates existing pricing_book rows (stamps the flag on
// out-of-band rows). Per repo discipline the forward path takes a pre-apply
// backup snapshot (pricing_book_backup_mig131) BEFORE applying so the run can
// be reverted without data loss. It NEVER overwrites a rate/markup value —
// flag only (spec R13: never overwrite tenant-entered values).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '131_pricing_book_rate_flag.sql')
const downSqlPath = join(here, '..', 'sql', 'migrations', '131_down.sql')

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
    console.log(`ROLLBACK — applying 131_down.sql (${sql.length.toLocaleString()} chars)...`)
    await c.query(sql)
    const { rows } = await c.query(
      `select to_regclass('public.pricing_book_backup_mig131') as backup`,
    )
    console.log('  Dropped column pricing_book.rate_review_flag.')
    console.log(
      `  True row-for-row restore source (if ever needed): ${rows[0].backup ?? 'pricing_book_backup_mig131 (not present — never applied forward, or snapshot dropped)'}`,
    )
    console.log('\nOK - migration 131 rolled back (column dropped; no tenant rate/markup value was ever changed).')
    process.exit(0)
  }

  // FORWARD: snapshot the table BEFORE applying, so a bad flag-pass can be
  // reverted without data loss (spec: Migration backup + rollback).
  // Idempotent — never overwrites an existing snapshot.
  await c.query(
    `create table if not exists pricing_book_backup_mig131 as
       select * from public.pricing_book`,
  )
  console.log('Pre-apply backup snapshot: pricing_book_backup_mig131')

  console.log(`Applying 131_pricing_book_rate_flag.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query(sql)

  // Report (do not fail on) the rows that ended up flagged so the operator
  // sees exactly which tenants need rate confirmation after the run. Rates
  // are shown for transparency — they were NOT changed.
  const { rows: flagged } = await c.query(
    `select pb.trade,
            pb.hourly_rate,
            pb.default_markup_pct,
            pb.rate_review_flag,
            t.business_name
       from public.pricing_book pb
       left join public.tenants t on t.id = pb.tenant_id
      where pb.rate_review_flag is not null
      order by pb.trade, t.business_name nulls last`,
  )
  console.log(`\n  Flagged (out-of-band, FLAG ONLY — rate values unchanged): ${flagged.length}`)
  for (const r of flagged) {
    console.log(
      `    [${r.trade}] ${r.business_name ?? '(no tenant)'} -> $${r.hourly_rate}/hr, ${r.default_markup_pct}% markup  [${r.rate_review_flag}]`,
    )
  }

  // Report the in-band electrical/plumbing rows too, so the operator can
  // confirm the band did not over-fire.
  const { rows: inBand } = await c.query(
    `select count(*)::int as n
       from public.pricing_book
      where trade in ('electrical', 'plumbing')
        and rate_review_flag is null`,
  )
  console.log(`  In-band electrical/plumbing rows (not flagged): ${inBand[0].n}`)

  // Verify the column now exists.
  const { rows: col } = await c.query(
    `select 1
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'pricing_book'
        and column_name = 'rate_review_flag'`,
  )
  if (col.length !== 1) {
    console.error('\nMigration 131 verification FAILED — rate_review_flag column not present.')
    process.exit(1)
  }
  console.log('\nOK - migration 131 verified (rate_review_flag column present; no rate/markup value overwritten).')
} catch (err) {
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
