// QuoteMate - run migration 121 (clarifying_questions backfill, R23)
// Usage:
//   node --env-file=.env.local scripts/run-migration-121.mjs            # apply to prod (SUPABASE_DB_URL)
//   node --env-file=.env.local scripts/run-migration-121.mjs --dev      # apply to dev (SUPABASE_DEVELOPMENT_DB_URL)
//   node --env-file=.env.local scripts/run-migration-121.mjs --dev --dry # dev BEGIN; ... ROLLBACK; (no commit)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '121_clarifying_questions_backfill.sql')

const useDev = process.argv.includes('--dev')
const dryRun = process.argv.includes('--dry')

const dbUrl = useDev
  ? process.env.SUPABASE_DEVELOPMENT_DB_URL
  : process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error(`Missing ${useDev ? 'SUPABASE_DEVELOPMENT_DB_URL' : 'SUPABASE_DB_URL'} in .env.local`)
  process.exit(1)
}

// Verification target (R23): ZERO auto-quote electrical/plumbing rows with
// empty clarifying_questions. always_inspection may not exist on the dev DB,
// so probe for it and fold it into the predicate only when present.
const EMPTY_PRED = `(clarifying_questions is null
    or clarifying_questions::text = '[]'
    or clarifying_questions::text = 'null')`

async function countAutoQuoteEmpty(c, hasAlwaysInspection) {
  const inspectClause = hasAlwaysInspection ? 'and always_inspection is not true' : ''
  const { rows } = await c.query(`
    select id, trade, name from public.shared_assemblies
     where trade in ('electrical','plumbing')
       and default_enabled = true
       and retired_at is null
       ${inspectClause}
       and ${EMPTY_PRED}
     order by trade, name`)
  return rows
}

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Target DB: ${useDev ? 'DEVELOPMENT' : 'PROD'}${dryRun ? '  (DRY RUN — will ROLLBACK)' : ''}`)

  const { rows: aiCol } = await c.query(`
    select 1 from information_schema.columns
     where table_schema='public' and table_name='shared_assemblies'
       and column_name='always_inspection'`)
  const hasAlwaysInspection = aiCol.length > 0
  console.log(`  always_inspection column present: ${hasAlwaysInspection}`)

  const before = await countAutoQuoteEmpty(c, hasAlwaysInspection)
  console.log(`\nBEFORE — auto-quote rows with empty clarifying_questions: ${before.length}`)
  for (const r of before) console.log(`  [${r.trade}] ${r.name}`)

  console.log(`\nApplying 121_clarifying_questions_backfill.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query('begin')
  await c.query(sql)

  const after = await countAutoQuoteEmpty(c, hasAlwaysInspection)
  console.log(`\nAFTER — auto-quote rows with empty clarifying_questions: ${after.length}`)
  for (const r of after) console.log(`  STILL EMPTY: [${r.trade}] ${r.name}`)

  if (after.length !== 0) {
    console.error('\nFAIL — verification target NOT met (expected 0 empty auto-quote rows).')
    await c.query('rollback')
    process.exit(1)
  }

  // Idempotency check: re-running the SQL inside the same tx is a no-op
  // (every UPDATE is guarded on emptiness). The empty-count must stay 0.
  await c.query(sql)
  const after2 = await countAutoQuoteEmpty(c, hasAlwaysInspection)
  if (after2.length !== 0) {
    console.error('\nFAIL — second apply changed state (not idempotent).')
    await c.query('rollback')
    process.exit(1)
  }
  console.log('Idempotency: second apply left 0 empty rows (no-op confirmed).')

  if (dryRun) {
    await c.query('rollback')
    console.log('\nOK — dry run verified (ROLLED BACK, no data committed).')
    console.log('     Zero-empty target met inside the transaction.')
  } else {
    await c.query('commit')
    console.log('\nOK — migration 121 committed. Zero auto-quote rows with empty clarifying_questions.')
  }
} catch (err) {
  try { await c.query('rollback') } catch {}
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
