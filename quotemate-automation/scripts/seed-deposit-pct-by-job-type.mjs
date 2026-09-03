// QuoteMate · seed the per-job-type deposit map (spec
// post-visit-money-sequence R2, Launch dependency 4).
//
// The post-site-visit final quote charges a deposit whose percentage depends
// on the JOB TYPE, not the trade: Jon's EV charger installs take 50% while his
// ordinary electrical work stays at 30%. That map lives in the tenant's
// pricing book overlay — config, not schema, following the migration-044
// precedent that put the early-bird offer there for the same reason.
//
//   pricing_book.overlays.deposit_pct_by_job_type
//     = { "ev_charger": 50, "default": 30 }
//
// Keys are `intakes.job_type` VERBATIM. The resolver
// (lib/quote/money.ts resolveDepositPct) looks for an exact key, then
// "default", then falls back to the platform 30.
//
// WHY THIS SCRIPT VALIDATES RATHER THAN JUST WRITING:
// clampDepositPct is a FALLBACK, not a clamp — anything outside 1..90 becomes
// 30. So a typo'd 100 (meaning "charge in full") would silently charge 30%,
// and nothing downstream would ever flag it. Catching it here, at write time,
// is the only place a human sees the mistake.
//
// Usage:
//   node --env-file=.env.local scripts/seed-deposit-pct-by-job-type.mjs \
//     --tenant <uuid> [--trade electrical] [--map '{"ev_charger":50,"default":30}'] [--apply]
//
// Dry-run by default: prints the current and proposed overlay and writes
// nothing without --apply.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const apply = process.argv.includes('--apply')
const tenantId = arg('tenant')
const trade = arg('trade', 'electrical')
const rawMap = arg('map', '{"ev_charger":50,"default":30}')

if (!tenantId) {
  console.error('Usage: --tenant <uuid> [--trade electrical] [--map \'{...}\'] [--apply]')
  process.exit(1)
}

let map
try {
  map = JSON.parse(rawMap)
} catch (e) {
  console.error(`--map is not valid JSON: ${e.message}`)
  process.exit(1)
}
if (!map || typeof map !== 'object' || Array.isArray(map)) {
  console.error('--map must be a JSON object, e.g. \'{"ev_charger":50,"default":30}\'')
  process.exit(1)
}

// Reject anything the resolver would silently turn into 30.
const bad = []
for (const [k, v] of Object.entries(map)) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 90 || v !== Math.round(v)) {
    bad.push(`  ${k}: ${JSON.stringify(v)} — must be a whole number 1..90`)
  }
}
if (bad.length > 0) {
  console.error('Refusing to seed — these values would silently fall back to 30%:')
  console.error(bad.join('\n'))
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: book, error: readErr } = await sb
  .from('pricing_book')
  .select('id, overlays')
  .eq('tenant_id', tenantId)
  .eq('trade', trade)
  .maybeSingle()

if (readErr) {
  console.error(`pricing_book read failed: ${readErr.message}`)
  process.exit(1)
}
if (!book) {
  // Deliberately not created here: a pricing book is produced by onboarding
  // with a full rate card, and inventing a bare row would leave the tenant
  // quoting off nothing.
  console.error(
    `No pricing_book row for tenant=${tenantId} trade=${trade}. ` +
      `Finish onboarding for that trade first.`,
  )
  process.exit(1)
}

const current = book.overlays ?? {}
const next = { ...current, deposit_pct_by_job_type: map }

console.log(`tenant : ${tenantId}`)
console.log(`trade  : ${trade}`)
console.log(`current: ${JSON.stringify(current.deposit_pct_by_job_type ?? null)}`)
console.log(`next   : ${JSON.stringify(map)}`)

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to save.')
  process.exit(0)
}

const { error: writeErr } = await sb
  .from('pricing_book')
  .update({ overlays: next })
  .eq('id', book.id)

if (writeErr) {
  console.error(`pricing_book update failed: ${writeErr.message}`)
  process.exit(1)
}
console.log('\nApplied.')
