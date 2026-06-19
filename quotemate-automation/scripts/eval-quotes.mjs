// ═══════════════════════════════════════════════════════════════════════
// QuoteMate · R15 hold-out eval harness (scorecard skeleton)
//
// WHY (spec R15): prove the deterministic pricing path is RIGHT, not just
// self-consistent. Runs the live deterministic estimate path over a set of
// (intake -> tradie-verified expected Good/Better/Best) pairs and scores each
// on a 6-dimension rubric, then prints a per-job-type + overall scorecard.
// Designed to wire into CI as a non-regression deploy gate (spec R15/R23):
// no pricing/data/prompt change ships if the score regresses.
//
// THE 6-DIM RUBRIC (spec R15):
//   1. price_within_band    — each tier total within ±band_pct of expected
//   2. material_correctness — headline product matches the expected product
//   3. bom_completeness     — every expected line is present (omitted-material
//                             check — the one error class grounding/spec-guard
//                             cannot catch; see the spec's residual-risk note)
//   4. tier_spread_sanity   — good <= better <= best, all distinct enough
//   5. labour_hours_sanity  — labour hours within ±band_pct of expected
//   6. route_correctness    — auto_send vs inspection matches expected
//
// ⚠ GROUND TRUTH IS FLAGGED FOR TRADIE GRADING. eval/holdout-pairs.json ships
// as STARTER PLACEHOLDERS with needs_grading=true and NULL expected prices.
// This harness REFUSES to score accuracy on a needs_grading pair — it only
// validates the rubric shape and prints a (placeholder) scorecard skeleton.
// A real deploy gate needs >=30 tradie-graded pairs (target 100). The expected
// numbers must come from a real tradie / documented AU source, NEVER invented
// here (flag-not-fabricate).
//
// RUN (placeholder/skeleton mode — no LLM, no keys, node --check clean):
//   node scripts/eval-quotes.mjs
//   node scripts/eval-quotes.mjs --pairs eval/holdout-pairs.json
//
// LIVE mode (once pairs are graded) needs the TS estimate path + Anthropic +
// Supabase keys, so it must run under tsx:
//   npx tsx --env-file=.env.local scripts/eval-quotes.mjs --live
// The live-path call is a clearly-marked TODO below (runEstimatePair).
// ═══════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, isAbsolute } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

// ─── args ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
function getArg(flag, fallback = null) {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const live = argv.includes('--live')
const pairsArg = getArg('--pairs', join('eval', 'holdout-pairs.json'))
const pairsPath = isAbsolute(pairsArg) ? pairsArg : join(repoRoot, pairsArg)

// ─── load + validate the fixtures ─────────────────────────────────────
let fixture
try {
  fixture = JSON.parse(readFileSync(pairsPath, 'utf8'))
} catch (e) {
  console.error(`Could not read pairs file at ${pairsPath}: ${e.message}`)
  process.exit(1)
}

const bandPct = Number.isFinite(fixture.band_pct) ? fixture.band_pct : 15
const pairs = Array.isArray(fixture.pairs) ? fixture.pairs : []
if (pairs.length === 0) {
  console.error(`No pairs in ${pairsPath} (expected a non-empty "pairs" array).`)
  process.exit(1)
}

// The 6 rubric dimensions, in scorecard order.
const RUBRIC_DIMS = [
  'price_within_band',
  'material_correctness',
  'bom_completeness',
  'tier_spread_sanity',
  'labour_hours_sanity',
  'route_correctness',
]

// ─── shape validation: a pair must carry an intake + an expected G/B/B ──
// We validate STRUCTURE here (so a malformed fixture fails loudly) but NOT
// the numbers — a needs_grading pair is allowed to carry NULL expected
// prices (that is exactly what "needs grading" means).
function validatePairShape(p, i) {
  const errs = []
  const tag = p?.id ?? `pair[${i}]`
  if (!p || typeof p !== 'object') return [`${tag}: not an object`]
  if (!p.intake || typeof p.intake !== 'object') errs.push(`${tag}: missing intake`)
  else {
    if (!p.intake.job_type) errs.push(`${tag}: intake.job_type missing`)
    if (!p.intake.trade) errs.push(`${tag}: intake.trade missing`)
  }
  if (!p.expected || typeof p.expected !== 'object') errs.push(`${tag}: missing expected`)
  else {
    for (const tier of ['good', 'better', 'best']) {
      if (!(tier in p.expected)) errs.push(`${tag}: expected.${tier} missing`)
    }
    if (!('route' in p.expected)) errs.push(`${tag}: expected.route missing`)
  }
  return errs
}

const shapeErrors = pairs.flatMap(validatePairShape)
if (shapeErrors.length > 0) {
  console.error('Fixture shape errors:')
  for (const e of shapeErrors) console.error(`  - ${e}`)
  process.exit(1)
}

// ─── the live-path hook (TODO — plugs in under tsx --live) ─────────────
// Runs ONE intake through the live deterministic estimate path and returns
// a drafted { good, better, best, route } in the same shape as `expected`.
// This is the only part that needs tsx + Anthropic/Supabase keys, which is
// why the default run is skeleton-only.
async function runEstimatePair(/* pair */) {
  // TODO(R15 live wiring): import the deterministic path and call it, e.g.
  //   const { runEstimate } = await import('../lib/estimate/run.ts')
  //   const intake = buildIntakeFromPair(pair)   // map fixture -> canonical Intake
  //   const draft  = await runEstimate(intake, { tenant, pricingBook, /* ... */ })
  //   return { good: draft.good, better: draft.better, best: draft.best,
  //            route: draft.routing_decision }
  // Requires DETERMINISTIC_BOM=1 + a resolved tenant/pricing_book in scope.
  // Until wired, --live is a no-op that reports "not yet wired".
  throw new Error('live estimate path not yet wired — see runEstimatePair TODO')
}

// ─── scoring (only runs on graded pairs in --live mode) ────────────────
// Each dimension returns 'pass' | 'fail' | 'skip'. 'skip' = not gradable
// (needs_grading, or expected value is null) — counts toward neither.
function withinBand(actual, expected, pct) {
  if (actual == null || expected == null) return 'skip'
  if (expected === 0) return Math.abs(actual) <= 0.5 ? 'pass' : 'fail'
  return Math.abs(actual - expected) / Math.abs(expected) <= pct / 100 ? 'pass' : 'fail'
}

function scorePair(pair, actual, pct) {
  const exp = pair.expected
  const dims = {}

  // 1. price_within_band — every offered tier within band.
  const priceVerdicts = ['good', 'better', 'best'].map((t) =>
    withinBand(actual?.[t]?.total_ex_gst, exp?.[t]?.total_ex_gst, pct),
  )
  dims.price_within_band = priceVerdicts.includes('fail')
    ? 'fail'
    : priceVerdicts.every((v) => v === 'skip')
      ? 'skip'
      : 'pass'

  // 2. material_correctness — headline product description match (loose, case-insensitive).
  // TODO(R15): compare the actual headline line vs expected line_items[0] per tier.
  dims.material_correctness = 'skip'

  // 3. bom_completeness — every expected line present in actual (omitted-material check).
  // TODO(R15): set-compare expected.line_items vs actual.line_items per tier.
  dims.bom_completeness = 'skip'

  // 4. tier_spread_sanity — good <= better <= best.
  const g = actual?.good?.total_ex_gst
  const b = actual?.better?.total_ex_gst
  const x = actual?.best?.total_ex_gst
  dims.tier_spread_sanity =
    [g, b, x].some((v) => v == null) ? 'skip' : g <= b && b <= x ? 'pass' : 'fail'

  // 5. labour_hours_sanity — total labour within band.
  const labourVerdicts = ['good', 'better', 'best'].map((t) =>
    withinBand(actual?.[t]?.labour_hours, exp?.[t]?.labour_hours, pct),
  )
  dims.labour_hours_sanity = labourVerdicts.includes('fail')
    ? 'fail'
    : labourVerdicts.every((v) => v === 'skip')
      ? 'skip'
      : 'pass'

  // 6. route_correctness — auto_send vs inspection.
  dims.route_correctness =
    actual?.route == null || exp?.route == null
      ? 'skip'
      : actual.route === exp.route
        ? 'pass'
        : 'fail'

  return dims
}

// ─── run ───────────────────────────────────────────────────────────────
const gradable = pairs.filter((p) => p.needs_grading !== true)
const ungraded = pairs.length - gradable.length

const rows = []
for (const pair of pairs) {
  if (pair.needs_grading === true) {
    rows.push({ pair, status: 'needs_grading', dims: null })
    continue
  }
  if (!live) {
    rows.push({ pair, status: 'skipped_skeleton', dims: null })
    continue
  }
  try {
    const actual = await runEstimatePair(pair)
    rows.push({ pair, status: 'scored', dims: scorePair(pair, actual, bandPct) })
  } catch (e) {
    rows.push({ pair, status: `error: ${e.message}`, dims: null })
  }
}

// ─── scorecard ──────────────────────────────────────────────────────────
const line = '═'.repeat(72)
console.log('\n' + line)
console.log('R15 EVAL SCORECARD' + (live ? ' (live)' : ' (skeleton — no live path)'))
console.log(line)
console.log(`pairs file:     ${pairsPath}`)
console.log(`total pairs:    ${pairs.length}`)
console.log(`band:           ±${bandPct}%`)
console.log(`gradable:       ${gradable.length}`)
console.log(`needs_grading:  ${ungraded}  (FLAGGED — excluded from any accuracy score)`)
console.log(`mode:           ${live ? 'live (deterministic estimate path)' : 'skeleton (shape-check only)'}`)

// Per-job-type breakdown of the rubric.
console.log('\n' + '─'.repeat(72))
console.log('PER-JOB-TYPE')
console.log('─'.repeat(72))
const byJob = new Map()
for (const r of rows) {
  const jt = r.pair.intake?.job_type ?? '(unknown)'
  if (!byJob.has(jt)) byJob.set(jt, [])
  byJob.get(jt).push(r)
}
for (const [jt, jrows] of [...byJob.entries()].sort()) {
  const scored = jrows.filter((r) => r.status === 'scored')
  const flagged = jrows.filter((r) => r.status === 'needs_grading').length
  if (scored.length === 0) {
    console.log(
      `  ${jt.padEnd(16)} ${jrows.length} pair(s) — 0 scored` +
        (flagged ? ` (${flagged} needs_grading)` : '') +
        (live ? '' : ' — run with tsx --live once graded'),
    )
    continue
  }
  const dimSummary = RUBRIC_DIMS.map((d) => {
    const pass = scored.filter((r) => r.dims?.[d] === 'pass').length
    const fail = scored.filter((r) => r.dims?.[d] === 'fail').length
    return `${d}=${pass}/${pass + fail}`
  }).join('  ')
  console.log(`  ${jt.padEnd(16)} ${scored.length} scored | ${dimSummary}`)
}

// Overall rubric tally (scored pairs only).
console.log('\n' + '─'.repeat(72))
console.log('OVERALL RUBRIC (scored pairs only)')
console.log('─'.repeat(72))
const scoredRows = rows.filter((r) => r.status === 'scored')
if (scoredRows.length === 0) {
  console.log('  (no pairs scored)')
  if (ungraded === pairs.length) {
    console.log('  → every pair is needs_grading. FLAG: grade the hold-out set')
    console.log('    against real AU prices + tradie-verified BOMs before this')
    console.log('    harness can gate a deploy (spec R15/R16). Do NOT invent the')
    console.log('    expected numbers.')
  } else if (!live) {
    console.log('  → skeleton mode. Re-run with:')
    console.log('    npx tsx --env-file=.env.local scripts/eval-quotes.mjs --live')
    console.log('    after wiring runEstimatePair (TODO) and grading the pairs.')
  }
} else {
  for (const d of RUBRIC_DIMS) {
    const pass = scoredRows.filter((r) => r.dims?.[d] === 'pass').length
    const fail = scoredRows.filter((r) => r.dims?.[d] === 'fail').length
    const skip = scoredRows.filter((r) => r.dims?.[d] === 'skip').length
    console.log(`  ${d.padEnd(22)} pass=${pass}  fail=${fail}  skip=${skip}`)
  }
  const fullyPassing = scoredRows.filter((r) =>
    RUBRIC_DIMS.every((d) => r.dims?.[d] !== 'fail'),
  ).length
  console.log(`\n  pairs with no failing dimension: ${fullyPassing}/${scoredRows.length}`)
  // Spec R23 deploy gate proposes >=80% of a trade's eval pairs in band.
  const passRate = fullyPassing / scoredRows.length
  console.log(`  pass-rate: ${(passRate * 100).toFixed(1)}%  (deploy gate proposes >=80% — spec R23)`)
}

console.log('\n' + line)
console.log(
  ungraded === pairs.length
    ? 'RESULT: skeleton OK — fixtures load + rubric shape valid. No accuracy'
    : live
      ? 'RESULT: live eval complete.'
      : 'RESULT: skeleton OK — fixtures load + rubric shape valid.',
)
if (ungraded === pairs.length) {
  console.log('measured (all pairs flagged needs_grading). This is BY DESIGN until')
  console.log('a tradie grades the hold-out set; flag-not-fabricate (spec R15).')
}
console.log(line + '\n')

// Skeleton/needs-grading is a SUCCESSFUL structural run, not a CI failure.
// Once graded + --live, a real gate would exit non-zero on regression
// (TODO: compare passRate to a stored baseline from measurable-targets.md).
process.exitCode = 0
