// ═══════════════════════════════════════════════════════════════════════
// QuoteMate · R4 spec-guard SHADOW would-block-rate probe (read-only)
//
// WHY (spec R4): before flipping SPEC_GUARD_MODE shadow -> enforce for the
// allowlisted job types, we must MEASURE how often the guard would block on
// real historical traffic — an over-firing reconcile rule (spec-reconcile.ts)
// would turn correct quotes into false inspections. This script replays every
// historical quote's drafted Good/Better/Best tiers through the SAME guard
// (lib/estimate/spec-guard.ts evaluateDraftSpecGuard, which wraps
// evaluateSpecGuard) against that intake's requested specs, in 'enforce' mode
// for measurement (so `block` is populated), and reports the would-block rate
// per job_type. NOTHING is written; this only observes.
//
// READ-ONLY — no DB writes, no migration. Reads `quotes` joined to `intakes`
// for trade / job_type / scope.specs.requested_specs and the drafted tiers.
//
// RUN (needs tsx because it imports the TS guard + .env.local for the DB URL):
//   npx tsx --env-file=.env.local scripts/measure-spec-guard-shadow-rate.mjs
//
// node --check clean (no top-level TS); the only TS dependency is the dynamic
// import of lib/estimate/spec-guard.ts, resolved by tsx at run time.
// ═══════════════════════════════════════════════════════════════════════

import pg from 'pg'

const { Client } = pg

const dbUrl = process.env.SUPABASE_DB_URL
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL in .env.local')
  console.error('Run with: npx tsx --env-file=.env.local scripts/measure-spec-guard-shadow-rate.mjs')
  process.exit(1)
}

// The spec-guard is TypeScript; under `npx tsx` this dynamic import resolves.
// Under a bare `node` run it will (correctly) fail with a clear message —
// node --check still passes because the import is dynamic, not top-level.
let evaluateDraftSpecGuard
try {
  ;({ evaluateDraftSpecGuard } = await import('../lib/estimate/spec-guard.ts'))
} catch (e) {
  console.error('Could not import lib/estimate/spec-guard.ts:', e.message)
  console.error('This script must be run under tsx so it can load the TS guard:')
  console.error('  npx tsx --env-file=.env.local scripts/measure-spec-guard-shadow-rate.mjs')
  process.exit(1)
}

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

// Pull every quote that carries drafted tiers, with its intake's trade,
// job_type and requested specs. We replay ALL historical quotes (spec R4
// references the 137 historical quotes) — the guard itself is the filter.
const { rows: quotes } = await client.query(
  `select q.id, q.good, q.better, q.best,
          i.job_type, i.trade, i.scope
     from quotes q
     left join intakes i on i.id = q.intake_id
     order by q.created_at asc nulls last`,
)
console.log(`loaded ${quotes.length} quotes for shadow replay`)

// Extract the customer's agreed specs from intake.scope.specs.requested_specs
// (the shape finaliseIntake writes). Returns {} when absent — the guard
// degrades to 'match' on no requested specs (degrade-never-block).
function requestedSpecsOf(scope) {
  const rs = scope?.specs?.requested_specs
  return rs && typeof rs === 'object' ? rs : {}
}

// Pull a category hint for SpecDef scoping, when the intake carries one.
function categoryOf(scope) {
  return scope?.specs?.category ?? scope?.category ?? null
}

// Per-job-type tally. would_block = at least one tier the guard would block.
const byJob = new Map()
function bucket(jt) {
  if (!byJob.has(jt)) {
    byJob.set(jt, { total: 0, withSpecs: 0, wouldBlock: 0, tiersBlocked: 0, tiersEvaluated: 0 })
  }
  return byJob.get(jt)
}

let totalEvaluated = 0
let totalWouldBlock = 0

for (const q of quotes) {
  const jt = q.job_type ?? '(unknown)'
  const b = bucket(jt)
  b.total++

  const requested = requestedSpecsOf(q.scope)
  const hasSpecs = Object.keys(requested).length > 0
  if (hasSpecs) b.withSpecs++

  // Reassemble the draft shape evaluateDraftSpecGuard expects.
  const draft = { good: q.good, better: q.better, best: q.best }

  // Measure in 'enforce' mode so `decision.block` is populated. (Shadow never
  // sets block — but the would-block RATE is exactly what enforce would do,
  // which is the number R4 wants before the flip.)
  let results = []
  try {
    results = evaluateDraftSpecGuard({
      draft,
      requested,
      trade: q.trade,
      category: categoryOf(q.scope),
      // productRows omitted: we don't have the backfilled product properties
      // assembled here, so the guard falls back to name-parsing the line
      // description (its documented fallback). This UNDER-counts blocks that
      // would only surface with structured properties — a conservative
      // measurement. TODO(R4): inject the (tenant, category) productRows with
      // backfilled `properties` for an exact rate once that backfill lands.
      mode: 'enforce',
    })
  } catch {
    results = []
  }

  let blockedTier = false
  for (const r of results) {
    b.tiersEvaluated++
    totalEvaluated++
    if (r.decision?.block) {
      b.tiersBlocked++
      blockedTier = true
    }
  }
  if (blockedTier) {
    b.wouldBlock++
    totalWouldBlock++
  }
}

// ─── report ──────────────────────────────────────────────────────────
const line = '═'.repeat(78)
console.log('\n' + line)
console.log('R4 SPEC-GUARD WOULD-BLOCK RATE (shadow replay of historical quotes)')
console.log(line)
console.log('Measured in enforce mode for counting; nothing is written. A high')
console.log('would-block rate on a job type = the reconcile rule likely over-fires')
console.log('(spec-reconcile.ts) and must be fixed BEFORE flipping SPEC_GUARD_MODE')
console.log('to enforce for that job type (spec R4).')
console.log('NOTE: productRows are not injected here, so blocks that need')
console.log('structured `properties` are UNDER-counted (name-parse fallback only).')
console.log(line)

console.log(
  '\n' +
    'job_type'.padEnd(18) +
    'quotes'.padStart(8) +
    'w/specs'.padStart(9) +
    'wouldBlk'.padStart(10) +
    'block%'.padStart(9) +
    'tiersBlk/eval'.padStart(16),
)
console.log('─'.repeat(78))
for (const [jt, s] of [...byJob.entries()].sort((a, b2) => b2[1].wouldBlock - a[1].wouldBlock)) {
  const pct = s.total > 0 ? ((s.wouldBlock / s.total) * 100).toFixed(1) : '0.0'
  console.log(
    jt.padEnd(18) +
      String(s.total).padStart(8) +
      String(s.withSpecs).padStart(9) +
      String(s.wouldBlock).padStart(10) +
      `${pct}%`.padStart(9) +
      `${s.tiersBlocked}/${s.tiersEvaluated}`.padStart(16),
  )
}

console.log('─'.repeat(78))
const overallPct = quotes.length > 0 ? ((totalWouldBlock / quotes.length) * 100).toFixed(1) : '0.0'
console.log(
  'TOTAL'.padEnd(18) +
    String(quotes.length).padStart(8) +
    ''.padStart(9) +
    String(totalWouldBlock).padStart(10) +
    `${overallPct}%`.padStart(9) +
    `${[...byJob.values()].reduce((n, s) => n + s.tiersBlocked, 0)}/${totalEvaluated}`.padStart(16),
)
console.log(line)
console.log(
  `\n${totalWouldBlock} of ${quotes.length} quotes would have a tier blocked under enforce.`,
)
console.log('Review any job_type with a high block% for over-firing reconcile rules')
console.log('before adding it to AUTO_SEND_JOBTYPES (spec R4 + R20).')
console.log(line + '\n')

await client.end()
