// TKO-15: scores the eval fixtures' readings against their hand-measured
// references (eval/roof-takeoff/<fixture>/takeoff.json) on the four P2 gates,
// each reading finished as the pipeline's calibrate stage finishes it. It
// scores the readings the live fixture test saves beside the plans:
//
//   TAKEOFF_LIVE_MODEL=1 npx vitest run lib/roofing/plan-takeoff/read.fixtures.test.ts
//   npx tsx scripts/eval-roof-takeoff.mts
//
// It writes nothing: recording a run in eval_runs and eval_run_items is a
// production write that waits for the owner's go-ahead. Exits 1 when a
// fixture has no reference or reading, or fails a gate.

import { existsSync, readFileSync } from 'node:fs'
import { planSheets, refineReading } from '@/lib/roofing/plan-takeoff/refine'
import { RoofPlanTakeoffSchema } from '@/lib/roofing/plan-takeoff/schema'
import { scoreTakeoff } from '@/lib/roofing/plan-takeoff/score'

const FIXTURES = [
  { name: 'grange', plans: 'docs/tag-roofing-requests/J14997-59-Grange-Rd' },
  { name: 'whittaker', plans: 'docs/tag-roofing-requests/J14945-5-Whittaker-St' },
]
const takeoff = (path: string) => RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync(path, 'utf8')))

let failed = false
for (const fixture of FIXTURES) {
  const reference = `eval/roof-takeoff/${fixture.name}/takeoff.json`
  const reading = `${fixture.plans}/reading.json`
  if (!existsSync(reference) || !existsSync(reading)) {
    console.log(`${fixture.name}: not scored, no ${existsSync(reference) ? 'saved reading' : 'reference takeoff'} yet`)
    failed = true
    continue
  }
  // Finished as the calibrate stage finishes it: the scale checked, and the
  // roofs the drawings don't dimension scaled from their outlines (TKO-29).
  const saved = takeoff(reading)
  const files = new Map([...new Set(planSheets(saved.sheets).map((s) => s.file))]
    .filter((file) => existsSync(`${fixture.plans}/${file}`))
    .map((file) => [file, new Uint8Array(readFileSync(`${fixture.plans}/${file}`))]))
  const refined = await refineReading(saved, { sheets: saved.sheets, files })
  const score = scoreTakeoff(takeoff(reference), refined.takeoff)
  failed ||= !score.pass
  console.log(`${fixture.name}: ${score.pass ? 'passes' : 'fails'} (scale ${refined.takeoff.scale.calibration.method}, ${refined.measured} planes scaled from outlines)`)
  for (const gate of ['structures', 'area', 'pitch', 'edges'] as const) {
    console.log(`  ${score[gate].pass ? 'pass' : 'FAIL'}  ${gate.padEnd(10)} ${score[gate].detail}`)
  }
}
process.exitCode = failed ? 1 : 0
