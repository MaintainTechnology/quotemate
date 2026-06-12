// Acceptance run for the Commercial Painting estimator (spec §9) against
// the four real IGA Swan Street pilot documents. Exercises the REAL
// pipeline cores end-to-end (classification heuristics → Opus plan
// takeoff → Sonnet measurements transcription → pure reconciliation →
// pure pricing over the live paint_rates seed) and prints a build-report
// summary with pass/fail per acceptance criterion.
//
// Usage:
//   node --env-file=.env.local --import tsx scripts/accept-commercial-painting.ts
//
// Writes the full machine-readable result to
//   scripts/output/commercial-painting-acceptance.json

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { classifyByFilename } from '../lib/commercial-painting/classify'
import {
  runPaintExtraction,
  runMeasurementParse,
} from '../lib/commercial-painting/extract'
import { reconcileTakeoff } from '../lib/commercial-painting/reconcile'
import { loadPaintRates, resolvePaintRates } from '../lib/commercial-painting/rates'
import { pricePaintTakeoff } from '../lib/commercial-painting/price'

const DOCS_DIR = 'C:/Users/dalig/Downloads/QuoteMate/commercial-painting'
const FILES = {
  plan: 'AS73 IGA Swan Street [CP1]_2026-05-16.pdf',
  measurements: 'IGA Swan Street painting areas measurments.pdf',
  services: 'ESS26073_M200_P1_DUCTWORK LAYOUT.pdf',
  photo: 'IGA 2.pdf',
}

type Check = { name: string; pass: boolean; detail: string }
const checks: Check[] = []
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail })
  console.log(`  ${pass ? 'PASS' : 'FAIL'} · ${name} — ${detail}`)
}

async function main() {
  console.log('━━ Commercial painting acceptance — IGA Swan Street ━━\n')

  // ── 1. Classification (filename heuristics; vision layer is additive) ─
  console.log('1) Classification')
  const cls = {
    plan: classifyByFilename(FILES.plan),
    measurements: classifyByFilename(FILES.measurements),
    services: classifyByFilename(FILES.services),
    photo: classifyByFilename(FILES.photo),
  }
  check(
    'plan set classified',
    cls.plan === 'plan_set',
    `${FILES.plan} → ${cls.plan}`,
  )
  check(
    'measurements classified',
    cls.measurements === 'measurement_takeoff',
    `${FILES.measurements} → ${cls.measurements}`,
  )
  check(
    'services layout classified',
    cls.services === 'services_layout',
    `${FILES.services} → ${cls.services}`,
  )
  // 'IGA 2.pdf' has no filename signal — vision classifies it in-app;
  // the heuristic must land on 'other' (never a wrong positive).
  check(
    'photo falls back safely',
    cls.photo === 'other' || cls.photo === 'site_photo',
    `${FILES.photo} → ${cls.photo} (vision corrects to site_photo in-app)`,
  )

  // ── 2. AI takeoff + measurements transcription (real model calls) ──
  console.log('\n2) Extraction (Opus plan takeoff + Sonnet measurements — runs minutes)')
  const planBytes = readFileSync(join(DOCS_DIR, FILES.plan))
  const servicesBytes = readFileSync(join(DOCS_DIR, FILES.services))
  const measurementBytes = readFileSync(join(DOCS_DIR, FILES.measurements))

  const [extraction, measurements] = await Promise.all([
    runPaintExtraction({
      planSet: planBytes,
      servicesLayout: servicesBytes,
      jobHint: 'IGA Swan Street — 480 Swan St, Richmond VIC 3121 (supermarket fit-out)',
    }),
    runMeasurementParse({ pdf: measurementBytes }),
  ])

  const items = extraction.parsed?.items ?? []
  const mLines = measurements.lines ?? []
  console.log(`  plan takeoff: ${items.length} lines (model ${extraction.model}, ${extraction.runtimeSeconds}s)`)
  console.log(`  measurements: ${mLines.length} lines (model ${measurements.model}, ${measurements.runtimeSeconds}s)`)

  check('plan takeoff produced lines', items.length >= 10, `${items.length} surface lines from the plan set`)
  check(
    'finishes schedule read',
    (extraction.parsed?.finishes_schedule.length ?? 0) >= 1,
    `${extraction.parsed?.finishes_schedule.length ?? 0} schedule entries`,
  )
  check(
    'measurements doc transcribed (~34 lines)',
    mLines.length >= 25 && mLines.length <= 45,
    `${mLines.length} lines vs the painter's 34`,
  )

  const mTotal = mLines.filter((l) => l.unit === 'm2').reduce((s, l) => s + l.quantity, 0)
  check(
    'measured area ≈ 1,100 m²',
    mTotal > 700 && mTotal < 1700,
    `${Math.round(mTotal)} m² transcribed total`,
  )
  const retailCeiling = mLines.find(
    (l) => /retail/i.test(`${l.room} ${l.surface}`) && /ceiling/i.test(l.surface) && l.quantity > 300,
  )
  check(
    'retail ceiling ≈ 420 m² present',
    !!retailCeiling,
    retailCeiling ? `${retailCeiling.surface} = ${retailCeiling.quantity} m²` : 'not found in transcription',
  )

  // ── 3. Reconciliation ───────────────────────────────────────────────
  console.log('\n3) Reconciliation')
  const reconciled = reconcileTakeoff(items, mLines)
  const bySource = {
    both: reconciled.items.filter((i) => i.source === 'both').length,
    measurements: reconciled.items.filter((i) => i.source === 'measurements').length,
    plan: reconciled.items.filter((i) => i.source === 'plan').length,
  }
  console.log(`  matched ${bySource.both} · measurements-only ${bySource.measurements} · plan-only ${bySource.plan} · flags ${reconciled.flags.length}`)
  check(
    'reconciliation matched lines across sources',
    bySource.both >= 5,
    `${bySource.both} lines matched plan↔measurements`,
  )
  check(
    'nothing dropped',
    reconciled.items.length >= Math.max(items.length, mLines.length),
    `${reconciled.items.length} merged lines ≥ max(${items.length} plan, ${mLines.length} measured)`,
  )
  const kitchenSemiGloss = reconciled.items.some(
    (i) => /kitchen|bathroom|wc|wet/i.test(`${i.room} ${i.surface}`) && i.system === 'semi_gloss',
  )
  check('kitchen/bathroom lines carry semi_gloss', kitchenSemiGloss, kitchenSemiGloss ? 'found' : 'none found')

  // ── 4. Pricing over the live seed rates ─────────────────────────────
  console.log('\n4) Pricing (paint_rates seed, pure TypeScript)')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const rateRows = await loadPaintRates(supabase, '00000000-0000-0000-0000-000000000000')
  const book = resolvePaintRates(rateRows)
  const bom = pricePaintTakeoff(reconciled.items, book)

  console.log(`  labour ${bom.labour.hours}h · crew ${bom.labour.crewSize} · ≈${bom.labour.estimatedDays} days`)
  console.log(`  materials ${bom.materials.reduce((s, m) => s + m.litres, 0)} L across ${bom.materials.length} products`)
  console.log(`  equipment ${bom.equipment.map((e) => `${e.label} × ${e.days}d`).join(', ') || 'none'}`)
  console.log(`  totals ex ${bom.subtotalExGst} + GST ${bom.gst} = inc ${bom.totalIncGst}`)

  check('non-zero labour hours and days', bom.labour.hours > 50 && bom.labour.estimatedDays >= 1, `${bom.labour.hours}h, ${bom.labour.estimatedDays} days`)
  check('per-product litres computed', bom.materials.length >= 2 && bom.materials.every((m) => m.litres > 0), `${bom.materials.length} products`)
  check(
    'lift-hire equipment line triggered (5.2 m surfaces)',
    bom.equipment.some((e) => e.code === 'equip:scissor_lift'),
    bom.equipment[0] ? `${bom.equipment[0].label}: ${bom.equipment[0].days} days — ${bom.equipment[0].reason}` : 'no equipment line',
  )
  check('tender total is sane', bom.totalIncGst > 10000 && bom.totalIncGst < 200000, `$${bom.totalIncGst.toLocaleString('en-AU')} inc GST`)
  check('unpriced lines disciplined', bom.unmatched.length <= 3, `${bom.unmatched.length} unmatched (returned unpriced, never guessed)`)

  // ── Report ──────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.pass)
  console.log(`\n━━ ${checks.length - failed.length}/${checks.length} acceptance checks passed ━━`)

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync(
    'scripts/output/commercial-painting-acceptance.json',
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        checks,
        classification: cls,
        planTakeoff: { model: extraction.model, runtimeSeconds: extraction.runtimeSeconds, lines: items },
        measurements: { model: measurements.model, runtimeSeconds: measurements.runtimeSeconds, lines: mLines },
        reconciled,
        bom,
      },
      null,
      2,
    ),
  )
  console.log('Full result → scripts/output/commercial-painting-acceptance.json')
  if (failed.length > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('ACCEPTANCE RUN FAILED:', e)
  process.exitCode = 1
})
