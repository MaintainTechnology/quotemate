// QuoteMate - run migration 122 (sms_conversations active-conversation unique
// index, R43 first-message conversation-create race backstop).
// Usage:
//   node --env-file=.env.local scripts/run-migration-122.mjs            # apply to prod (SUPABASE_DB_URL)
//   node --env-file=.env.local scripts/run-migration-122.mjs --dev      # apply to dev (SUPABASE_DEVELOPMENT_DB_URL)
//   node --env-file=.env.local scripts/run-migration-122.mjs --dev --dry # dev BEGIN; ... ROLLBACK; (no commit)
//   node --env-file=.env.local scripts/run-migration-122.mjs --rollback  # reverse (run 122_down.sql; honours --dev/--dry)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '122_sms_conversation_active_unique.sql')
const downSqlPath = join(here, '..', 'sql', 'migrations', '122_down.sql')

const useDev = process.argv.includes('--dev')
const dryRun = process.argv.includes('--dry')
const rollback = process.argv.includes('--rollback')

const dbUrl = useDev
  ? process.env.SUPABASE_DEVELOPMENT_DB_URL
  : process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error(`Missing ${useDev ? 'SUPABASE_DEVELOPMENT_DB_URL' : 'SUPABASE_DB_URL'} in .env.local`)
  process.exit(1)
}

// Pre-flight: surface any (from_number, to_number) that ALREADY has >1 active
// customer_quote conversation. CREATE UNIQUE INDEX would fail on these (they are
// exactly the split-brain rows this migration prevents going forward); they must
// be reconciled first. We only report — we never delete.
const DUP_QUERY = `
  select from_number, to_number, count(*) as active_rows
    from public.sms_conversations
   where status in ('open','structuring')
     and conversation_type = 'customer_quote'
   group by from_number, to_number
  having count(*) > 1
   order by active_rows desc`

async function indexPresent(c) {
  const { rows } = await c.query(`
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'sms_conversations_active_customer_quote_unique'`)
  return rows.length > 0
}

async function functionPresent(c) {
  const { rows } = await c.query(`
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'create_sms_conversation_idempotent'`)
  return rows.length > 0
}

// End-to-end race proof: two inserts for the same active (from,to) must
// collapse to ONE row. Runs inside the migration tx and is rolled back.
async function proveRace(c) {
  const FROM = '+RACECHECK122'
  const TO = '+DSTCHECK122'
  await c.query(
    `select public.create_sms_conversation_idempotent($1,$2,'open',null,null,'tok1','{}'::jsonb)`,
    [FROM, TO],
  )
  await c.query(
    `select public.create_sms_conversation_idempotent($1,$2,'open',null,null,'tok2','{}'::jsonb)`,
    [FROM, TO],
  )
  const { rows } = await c.query(
    `select count(*)::int as n from public.sms_conversations
      where from_number=$1 and to_number=$2
        and conversation_type='customer_quote'
        and status in ('open','structuring')`,
    [FROM, TO],
  )
  return rows[0].n
}

const sql = readFileSync(rollback ? downSqlPath : sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()
  console.log(`Target DB: ${useDev ? 'DEVELOPMENT' : 'PROD'}${dryRun ? '  (DRY RUN — will ROLLBACK)' : ''}`)

  if (rollback) {
    // DDL-only migration: no data rows change, so there is no pre-apply
    // snapshot to take (spec backup rule applies to data-correction
    // migrations). Re-applying the forward SQL fully recreates both objects.
    console.log('\nDDL-only migration — no data snapshot needed for rollback.')
    console.log(`ROLLBACK — applying 122_down.sql (${sql.length.toLocaleString()} chars)...`)
    await c.query('begin')
    await c.query(sql)
    const indexStillPresent = await indexPresent(c)
    const functionStillPresent = await functionPresent(c)
    if (indexStillPresent || functionStillPresent) {
      console.error(
        `\nFAIL — after rollback, index present=${indexStillPresent}, function present=${functionStillPresent} (expected both false).`,
      )
      await c.query('rollback')
      process.exit(1)
    }
    if (dryRun) {
      await c.query('rollback')
      console.log('\nOK — rollback dry run verified (ROLLED BACK, nothing dropped).')
    } else {
      await c.query('commit')
      console.log('\nOK — migration 122 rolled back (unique index + idempotent-create function dropped).')
    }
    process.exit(0)
  }

  // DDL-only migration: no data rows change, so the spec's pre-apply data
  // snapshot is intentionally skipped here.
  console.log('DDL-only migration — no data snapshot needed (schema objects only).')

  const { rows: dups } = await c.query(DUP_QUERY)
  if (dups.length > 0) {
    console.error(`\nBLOCKED — ${dups.length} (from_number,to_number) pair(s) already have >1 active customer_quote conversation:`)
    for (const d of dups) console.error(`  ${d.from_number} -> ${d.to_number}: ${d.active_rows} active rows`)
    console.error('\nReconcile these (close the stale duplicates to done/abandoned) before applying the unique index.')
    process.exit(1)
  }
  console.log('Pre-flight OK — no existing duplicate active customer_quote conversations.')

  console.log(`\nApplying 122_sms_conversation_active_unique.sql (${sql.length.toLocaleString()} chars)...`)
  await c.query('begin')
  await c.query(sql)

  if (!(await indexPresent(c))) {
    console.error('\nFAIL — index not present after apply.')
    await c.query('rollback')
    process.exit(1)
  }
  console.log('Index present: sms_conversations_active_customer_quote_unique')
  if (!(await functionPresent(c))) {
    console.error('\nFAIL — create_sms_conversation_idempotent function not present after apply.')
    await c.query('rollback')
    process.exit(1)
  }
  console.log('Function present: create_sms_conversation_idempotent')

  const raceRows = await proveRace(c)
  if (raceRows !== 1) {
    console.error(`\nFAIL — race proof: expected 1 active row after double-create, got ${raceRows}.`)
    await c.query('rollback')
    process.exit(1)
  }
  console.log('Race proof: two concurrent first-message creates collapsed to 1 active row.')

  // Idempotency check: re-running the SQL inside the same tx is a no-op
  // (create unique index IF NOT EXISTS + create or replace function).
  await c.query(sql)
  if (!(await indexPresent(c)) || !(await functionPresent(c))) {
    console.error('\nFAIL — second apply changed state (not idempotent).')
    await c.query('rollback')
    process.exit(1)
  }
  console.log('Idempotency: second apply was a no-op (index + function still present).')

  if (dryRun) {
    await c.query('rollback')
    console.log('\nOK — dry run verified (ROLLED BACK, no schema committed).')
  } else {
    await c.query('commit')
    console.log('\nOK — migration 122 committed. Active customer_quote conversations are now unique per (from_number, to_number).')
  }
} catch (err) {
  try { await c.query('rollback') } catch {}
  console.error('Migration failed:', err.message ?? err)
  process.exit(1)
} finally {
  await c.end()
}
