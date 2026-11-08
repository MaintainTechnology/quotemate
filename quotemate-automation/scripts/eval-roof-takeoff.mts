// TKO-15: the eval (DEC-040). Each fixture goes through the pipeline as a run
// does, and its reading is scored against its hand-measured reference on the
// four P2 gates. Fixtures come from the plans bucket under eval/<fixture>/
// (scripts/upload-eval-fixtures.mjs puts them there), or with --local from
// eval/roof-takeoff/ and the git-ignored plans beside it.
//
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/eval-roof-takeoff.mts [options]
//     --local         the fixtures in this checkout, not the bucket's
//     --model <id>    the reader's model, for D-07 (sets TAKEOFF_MODEL)
//     --broken        the reader's prompt with its rules taken out: every fixture must then fail
//     --max-output <n>  the reader's output limit, for a model whose thinking counts against it
//     --effort <level>  the reader's effort: low, medium, high, xhigh or max
//     --repeat <n>    each fixture n times, to see whether it reads the same way
//     --only <name>   one fixture
//     --record        write the run to eval_runs and eval_run_items
//     --saved         score the readings the live fixture test saved, with no model call
//
// Exits 1 when a reading fails a gate or, with --broken, when one passes.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { brokenPrompt, evalFixture, loadFixtures, promptVersion, recordEval, swapReader, type Effort, type EvalFixture, type FixtureResult } from '@/lib/roofing/plan-takeoff/eval'
import { DEFAULT_TAKEOFF_MODEL } from '@/lib/roofing/plan-takeoff/read'
import { elevationSheets, planSheets, refineReading } from '@/lib/roofing/plan-takeoff/refine'
import { placeRegions, RegionAnswersSchema } from '@/lib/roofing/plan-takeoff/regions'
import { RoofPlanTakeoffSchema } from '@/lib/roofing/plan-takeoff/schema'
import { scoreTakeoff, type Score } from '@/lib/roofing/plan-takeoff/score'
import { getServiceClient } from '@/lib/supabase/admin'

// The same fixtures as scripts/upload-eval-fixtures.mjs.
const FIXTURES = [
  { name: 'grange', plans: 'docs/tag-roofing-requests/grange' },
  { name: 'whittaker', plans: 'docs/tag-roofing-requests/whittaker' },
]
const GATES = ['structures', 'area', 'pitch', 'edges'] as const
const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean' }, model: { type: 'string' }, broken: { type: 'boolean' }, repeat: { type: 'string' },
    only: { type: 'string' }, record: { type: 'boolean' }, saved: { type: 'boolean' },
    'max-output': { type: 'string' }, effort: { type: 'string' },
  },
})
const chosen = FIXTURES.filter((f) => !args.only || f.name === args.only)
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const reference = (name: string) => RoofPlanTakeoffSchema.parse(json(`eval/roof-takeoff/${name}/takeoff.json`))
/** The operator's answer to the fixture's numbered roof areas (TKO-30), when it has one. */
const operatorOf = (name: string) => {
  const path = `eval/roof-takeoff/${name}/operator.json`
  return existsSync(path) ? RegionAnswersSchema.parse(json(path).areas) : null
}
const pdfs = (folder: string) => new Map(readdirSync(folder).filter((f) => /\.pdf$/i.test(f)).sort().map((f) => [f, new Uint8Array(readFileSync(`${folder}/${f}`))]))
const show = (name: string, score: Score, about: string) => {
  console.log(`${name}: ${score.pass ? 'passes' : 'fails'} (${about})`)
  for (const gate of GATES) console.log(`  ${score[gate].pass ? 'pass' : 'FAIL'}  ${gate.padEnd(10)} ${score[gate].detail}`)
}

/** The readings the live fixture test saved, finished as the calibrate stage finishes them. */
async function saved(): Promise<boolean> {
  let pass = true
  for (const fixture of chosen) {
    const path = `${fixture.plans}/reading.json`
    if (!existsSync(path)) {
      console.log(`${fixture.name}: no saved reading`)
      pass = false
      continue
    }
    const reading = RoofPlanTakeoffSchema.parse(json(path))
    // The files the calibrate stage downloads: the plans, and the elevations it pitches from (TKO-30).
    const wanted = [...planSheets(reading.sheets), ...elevationSheets(reading.sheets)]
    const files = new Map([...pdfs(fixture.plans)].filter(([file]) => wanted.some((s) => s.file === file)))
    const refined = await refineReading(reading, { sheets: reading.sheets, files })
    // The operator's answer to the numbered roof areas, measured as the run page measures it.
    const operator = operatorOf(fixture.name)
    const placed = refined.regions && operator ? placeRegions(refined.takeoff, refined.regions.stored, operator) : null
    if (placed && !placed.ok) console.log(`${fixture.name}: the operator's answer couldn't be measured: ${placed.problems.join(' ')}`)
    const score = scoreTakeoff(reference(fixture.name), placed?.ok ? placed.takeoff : refined.takeoff)
    pass &&= score.pass
    const regions = refined.regions ? `, ${refined.regions.stored.areas.length} roof areas numbered and ${placed?.ok ? placed.placed : 0} measured as the operator answered` : ''
    show(fixture.name, score, `saved reading; scale ${refined.takeoff.scale.calibration.method}, ${refined.measured} planes scaled from outlines, ${refined.pitched} pitched from an elevation, ${refined.hipped} measured from a hip roof's lines, ${refined.derived} skillions' edges worked out${regions}`)
  }
  return pass
}

/** Each fixture read live, as a run is. */
async function live(): Promise<boolean> {
  if (args.model) process.env.TAKEOFF_MODEL = args.model
  const model = process.env.TAKEOFF_MODEL?.trim() || DEFAULT_TAKEOFF_MODEL
  const system = args.broken ? brokenPrompt : undefined
  const swap = { system, maxOutputTokens: args['max-output'] ? Number(args['max-output']) : undefined, effort: args.effort as Effort | undefined }
  const generate = swap.system || swap.maxOutputTokens || swap.effort ? swapReader(swap) : undefined
  const settings = [system && 'broken prompt', swap.maxOutputTokens && `${swap.maxOutputTokens} output tokens`, swap.effort && `effort ${swap.effort}`].filter(Boolean).join(', ')
  const repeat = Math.max(1, Number(args.repeat ?? 1))
  const fixtures: EvalFixture[] = args.local
    ? chosen.map(({ name, plans }) => ({ name, request: json(`eval/roof-takeoff/${name}/request.json`), reference: reference(name), files: pdfs(plans), operator: operatorOf(name) }))
    : (await loadFixtures(getServiceClient(), process.env.TAKEOFF_STORAGE_BUCKET?.trim() || 'plan-pdfs')).filter((f) => !args.only || f.name === args.only)

  const startedAt = new Date()
  const results: FixtureResult[] = []
  for (let read = 1; read <= repeat; read++) {
    for (const fixture of fixtures) {
      const started = Date.now()
      const result = await evalFixture(fixture, { generate })
      const seconds = Math.round((Date.now() - started) / 1000)
      const name = repeat > 1 ? `${fixture.name} (read ${read} of ${repeat})` : fixture.name
      results.push({ ...result, fixture: name })
      const status = result.status ?? `read failed: ${result.note}`
      show(name, result.score, `${model}${settings ? `, ${settings}` : ''}; ${status}; ${result.usage.calls} model calls, ${result.usage.inputTokens} in and ${result.usage.outputTokens} out; ${seconds} s`)
    }
  }
  if (args.record) {
    const id = await recordEval(getServiceClient(), results, { model, promptVersion: promptVersion(system), startedAt })
    console.log(`Recorded as eval run ${id}.`)
  }
  const passing = results.filter((r) => r.score.pass).length
  console.log(`${passing} of ${results.length} readings pass every gate${system ? '; the broken prompt must pass none' : ''}.`)
  return system ? passing === 0 : passing === results.length
}

process.exitCode = (args.saved ? await saved() : await live()) ? 0 : 1
