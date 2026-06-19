// QuoteMate - run migration 130 (structural catalogue integrity, R11).
// Usage:
//   node --env-file=.env.local scripts/run-migration-130.mjs            # forward (SUPABASE_DB_URL)
//   node --env-file=.env.local scripts/run-migration-130.mjs --rollback # reverse (run 130_down.sql)
//
// DATA MIGRATION: it mutates shared_assembly_bom rows (sundry -> sundries),
// so the runner takes pre-apply backup snapshots of BOTH affected tables
// before applying (shared_materials_backup_mig130, shared_assembly_bom_backup_mig130)
// per the migration backup discipline. A bad apply can be reverted via
// 130_down.sql (drops the index + resets the column comment) plus the
// snapshot restore documented in 130_down.sql for the one-way data change.
//
// Pre-flight: because migration 130 creates a UNIQUE index on
// shared_materials (trade, lower(category), lower(name)), the runner FIRST
// reports any existing duplicate group — CREATE UNIQUE INDEX would fail on
// those, and they are FLAGGED for owner de-dup (never auto-deleted). It also
// reports the brand=NULL rows left flagged for owner input.
//
// NEVER run against prod without reviewing 130_catalogue_integrity.sql.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '130_catalogue_integrity.sql')
const downSqlPath = join(here, '..', 'sql', 'migrations', '130_down.sql')

const rollback = process.argv.includes('--rollback')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

// (trade, lower(category), lower(name)) groups that already have >1 row — the
// duplicate products the unique index forbids. CREATE UNIQUE INDEX fails on
// these; they must be reconciled by the owner first. We only report.
const DUP_QUERY = `
  select trade, lower(category) as category, lower(name) as name, count(*) as dupes
    from shared_materials
   group by trade, lower(category), lower(name)
  having count(*) > 1
   order by dupes desc, trade, category, name`

// BOM lines still on the singular 'sundry' (the value 130 normalises away).
const SUNDRY_QUERY = `
  select count(*)::int as n
    from shared_assembly_bom
   where lower(material_category) = 'sundry'`

// shared_materials rows missing a brand — flagged for owner input, never
// fabricated (flag-not-fabricate). Reported, not changed.
const NULL_BRAND_QUERY = `
  select trade, name
    from shared_materials
   where brand is null or brand = ''
   order by trade, name`

const sql = readFileSync(rollback ? downSqlPath : sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

async function indexPresent(client) {
  const { rows } = await client.query(`
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'shared_materials_trade_cat_name_uniq'`)
  return rows.length > 0
}

try {
  await c.connect()

  if (rollback) {
    console.log(`ROLLBACK — applying 130_down.sql (${sql.length.toLocaleString()} chars)...`)
    console.log(
      'NOTE: the sundry -> sundries data change is one-way; 130_down.sql only ' +
        'drops the index + resets the column comment. Restore exact pre-130 ' +
        'material_category values from shared_assembly_bom_backup_mig130 (see 130_down.sql).',
    )
    await c.query('begin')
    await c.query(sql)
    if (await indexPresent(c)) {
      console.error('\nFAIL — index still present after rollback (expected dropped).')
      await c.query('rollback')
      process.exit(1)
    }
    await c.query('commit')
    console.log('\nOK — migration 130 rolled back (unique index dropped, column comment reset).')
    process.exit(0)
  }

  // ── FORWARD ─────────────────────────────────────────────────────────
  // Pre-apply backup snapshots (DATA migration). Idempotent — never
  // overwrites an existing snapshot.
  await c.query(
    `create table if not exists shared_materials_backup_mig130 as
       select * from shared_materials`,
  )
  await c.query(
    `create table if not exists shared_assembly_bom_backup_mig130 as
       select * from shared_assembly_bom`,
  )
  console.log('Pre-apply backup snapshots: shared_materials_backup_mig130, shared_assembly_bom_backup_mig130')

  // Pre-flight: duplicates would make CREATE UNIQUE INDEX fail. Report and
  // BLOCK — the owner reconciles duplicates by hand (we never auto-delete).
  const { rows: dups } = await c.query(DUP_QUERY)
  if (dups.length > 0) {
    console.error(
      `\nBLOCKED — ${dups.length} duplicate (trade, category, name) group(s) exist; the ` +
        'unique index cannot be created until they are de-duped (FLAGGED for owner, not auto-deleted):',
    )
    for (const d of dups) {
      console.error(`  [${d.trade}] ${d.category} / "${d.name}": ${d.dupes} rows`)
    }
    console.error(
      '\nReconcile these by hand (decide which row survives), then re-run. ' +
        'See scripts/audit-catalogue-integrity.mjs for the full integrity report.',
    )
    process.exit(1)
  }
  console.log('Pre-flight OK — no duplicate (trade, category, name) groups.')

  const { rows: sundryBefore } = await c.query(SUNDRY_QUERY)
  console.log(`Pre-apply: ${sundryBefore[0].n} shared_assembly_bom row(s) on singular 'sundry'.`)

  console.log(`\nApplying 130_catalogue_integrity.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query('begin')
  await c.query(sql)

  if (!(await indexPresent(c))) {
    console.error('\nFAIL — shared_materials_trade_cat_name_uniq not present after apply.')
    await c.query('rollback')
    process.exit(1)
  }

  const { rows: sundryAfter } = await c.query(SUNDRY_QUERY)
  if (sundryAfter[0].n > 0) {
    console.error(
      `\nWARNING — ${sundryAfter[0].n} 'sundry' row(s) remain after normalise (collision-guarded ` +
        'skips). These need manual reconcile against the existing sundries line — see audit script.',
    )
  }
  await c.query('commit')
  console.log('Index present: shared_materials_trade_cat_name_uniq')
  console.log(`Normalise: 'sundry' rows reduced from ${sundryBefore[0].n} to ${sundryAfter[0].n}.`)

  // Report (do not fail on) the flagged-for-owner brand NULLs after every run.
  const { rows: nullBrands } = await c.query(NULL_BRAND_QUERY)
  console.log(`\n  brand=NULL shared_materials rows (FLAGGED — owner input, never fabricated): ${nullBrands.length}`)
  for (const r of nullBrands) console.log(`    [${r.trade}] "${r.name}"`)

  console.log('\nOK — migration 130 committed.')
} catch (err) {
  try {
    await c.query('rollback')
  } catch {}
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
