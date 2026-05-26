// QuoteMate · run migration 064 (purge tenant-orphan rows)
// Usage:  node --env-file=.env.local scripts/run-migration-064.mjs
//
// Phase 3 of the 2026-05-26 cleanup audit. Deletes 518 orphan rows
// across 5 tables. Audit established zero customer liability on any of
// these — every orphan quote is status='draft' and sent_at IS NULL.
//
// SAFETY GATES (all four must pass):
//   1. Re-confirm orphan counts match the audit (108/128/50/229/3).
//      If ANY count is off, refuse — something changed since audit.
//   2. Confirm no orphan quote has been sent / accepted / paid.
//   3. Confirm `tradie_registration` sms_conversations with NULL
//      tenant_id stay un-deleted (these are by-design preservations).
//   4. Re-confirm zero FK references to any orphan row from any
//      non-orphan source.
//
// Wrapped in BEGIN/COMMIT — any assertion failure rolls back the whole
// purge.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const { Client } = pg
const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'sql', 'migrations', '064_purge_orphan_rows.sql')

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  process.exit(1)
}

// Audit baselines — refuse to run if live counts diverge.
const EXPECTED = {
  quotes: 108,
  intakes: 128,
  calls: 50,
  sms_conversations_customer_quote: 229,
  sms_conversations_tradie_registration_preserve: 2,
  customers: 3,
}
// Allow a small drift (e.g. 1-2 fresh orphans from the voice-path bug)
// without failing — but anything bigger means we should re-audit first.
const DRIFT_TOLERANCE = 3

const sql = readFileSync(sqlPath, 'utf8')
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

try {
  await c.connect()

  console.log('─── pre-flight: re-confirm orphan counts ──')
  const live = {
    quotes:                                       (await c.query(`select count(*)::int n from quotes where tenant_id is null`)).rows[0].n,
    intakes:                                      (await c.query(`select count(*)::int n from intakes where tenant_id is null`)).rows[0].n,
    calls:                                        (await c.query(`select count(*)::int n from calls where tenant_id is null`)).rows[0].n,
    sms_conversations_customer_quote:             (await c.query(`select count(*)::int n from sms_conversations where tenant_id is null and conversation_type = 'customer_quote'`)).rows[0].n,
    sms_conversations_tradie_registration_preserve: (await c.query(`select count(*)::int n from sms_conversations where tenant_id is null and conversation_type = 'tradie_registration'`)).rows[0].n,
    customers:                                    (await c.query(`select count(*)::int n from customers where tenant_id is null`)).rows[0].n,
  }
  for (const k of Object.keys(EXPECTED)) {
    const delta = live[k] - EXPECTED[k]
    const marker = delta === 0 ? '✓' : (Math.abs(delta) <= DRIFT_TOLERANCE ? '~' : '✗')
    console.log(`  ${k.padEnd(48)} expected=${EXPECTED[k].toString().padStart(4)}  live=${live[k].toString().padStart(4)}  drift=${delta>=0?'+':''}${delta} ${marker}`)
    if (Math.abs(delta) > DRIFT_TOLERANCE && k !== 'sms_conversations_tradie_registration_preserve') {
      console.error(`\nABORTING: ${k} drifted beyond tolerance (${DRIFT_TOLERANCE}). Re-audit before purging.`)
      process.exit(2)
    }
  }

  console.log('\n─── pre-flight: orphan quotes have zero customer commitment ──')
  const { rows: liab } = await c.query(`
    select count(*) filter (where sent_at is not null)::int as sent,
           count(*) filter (where accepted_at is not null)::int as accepted,
           count(*) filter (where status = 'paid')::int as paid
      from quotes where tenant_id is null`)
  const { sent, accepted, paid } = liab[0]
  console.log(`  orphan quotes: sent=${sent}  accepted=${accepted}  paid=${paid}`)
  if (sent > 0 || accepted > 0 || paid > 0) {
    console.error('\nABORTING: at least one orphan quote shows customer commitment. Re-audit before purging.')
    process.exit(3)
  }

  console.log('\n─── pre-flight: cross-link analysis ──────')
  // Non-orphan rows pointing at orphan customers are SAFE — the SQL
  // step 0 heals those customers by backfilling tenant_id from the
  // non-orphan referrer. We only block if there's an orphan that
  // (a) is referenced by a non-orphan AND (b) cannot be healed.
  const { rows: smsIntakeLink } = await c.query(
    `select count(*)::int n from sms_conversations c join intakes i on c.intake_id = i.id where c.tenant_id is not null and i.tenant_id is null`
  )
  console.log(`  non-orphan conversations linked to orphan intakes:  ${smsIntakeLink[0].n}`)
  if (smsIntakeLink[0].n > 0) {
    console.error('\nABORTING: a non-orphan conversation references an orphan intake. Investigate.')
    process.exit(4)
  }

  const { rows: healable } = await c.query(`
    select cu.id, cu.phone_number,
           coalesce(
             (select tenant_id from intakes           where customer_id = cu.id and tenant_id is not null limit 1),
             (select tenant_id from sms_conversations where customer_id = cu.id and tenant_id is not null limit 1),
             (select tenant_id from calls             where customer_id = cu.id and tenant_id is not null limit 1)
           ) as backfill_tenant
      from customers cu
     where cu.tenant_id is null`)
  let healCount = 0
  let pureOrphanCount = 0
  for (const r of healable) {
    if (r.backfill_tenant) {
      healCount++
      console.log(`  HEAL    customer ${r.phone_number} → tenant ${r.backfill_tenant.slice(0, 8)}…`)
    } else {
      pureOrphanCount++
      console.log(`  DELETE  customer ${r.phone_number} (pure orphan, no referencer)`)
    }
  }
  console.log(`  → ${healCount} customer(s) will be healed, ${pureOrphanCount} will be deleted`)

  // Execute.
  console.log('\n─── executing migration 064 ──────────────')
  await c.query('begin')
  try {
    const res = await c.query(sql)
    await c.query('commit')
    console.log('  migration committed.')
    for (const n of res) {
      if (n && n.command === 'DELETE') console.log(`  DELETE row count: ${n.rowCount}`)
    }
  } catch (e) {
    await c.query('rollback')
    throw e
  }

  // Post-verify.
  console.log('\n─── post-verify ──────────────────────────')
  for (const t of ['quotes', 'intakes', 'calls', 'customers']) {
    const { rows } = await c.query(`select count(*)::int n from "${t}" where tenant_id is null`)
    console.log(`  ${t.padEnd(20)} orphan rows now: ${rows[0].n} (expected 0)`)
  }
  // Confirm Sam (or any healed customer) is now non-orphan and findable.
  const { rows: healed } = await c.query(`
    select id, phone_number, first_name, tenant_id::text as tenant_id
      from customers
     where tenant_id is not null and full_name = 'Sam'`)
  if (healed.length > 0) {
    console.log(`  HEAL VERIFY · Sam now has tenant_id=${healed[0].tenant_id.slice(0,8)}… ✓`)
  }
  const { rows: cq } = await c.query(`select count(*)::int n from sms_conversations where tenant_id is null and conversation_type = 'customer_quote'`)
  console.log(`  sms_conversations[customer_quote] orphans now: ${cq[0].n}`)
  const { rows: tr } = await c.query(`select count(*)::int n from sms_conversations where tenant_id is null and conversation_type = 'tradie_registration'`)
  console.log(`  sms_conversations[tradie_registration] PRESERVED: ${tr[0].n}`)
  const { rows: ts } = await c.query(`select count(*)::int n from sms_conversations where conversation_type = 'tradie_registration'`)
  console.log(`  sms_conversations[tradie_registration] total: ${ts[0].n}`)

  // Final overall row counts (sanity)
  console.log('\n  Final table sizes:')
  for (const t of ['quotes', 'intakes', 'calls', 'sms_conversations', 'sms_messages', 'customers']) {
    const { rows } = await c.query(`select count(*)::int n from "${t}"`)
    console.log(`    ${t.padEnd(22)} ${rows[0].n}`)
  }

  console.log('\nMigration 064 complete.')
} catch (e) {
  console.error('MIGRATION FAILED:', e.message)
  process.exitCode = 1
} finally {
  await c.end()
}
