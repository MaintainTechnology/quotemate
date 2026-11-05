// Rank 1 evaluation. Offline replay is the default; adapters require explicit opt-in.
// This module imports no provider, database, quote persistence, or SMS clients.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { digest } from './eval-hash.mjs'
export { digest } from './eval-hash.mjs'

export const TIERS = ['good', 'better', 'best']
export const DIMENSIONS = ['price_within_band', 'material_correctness', 'bom_completeness',
  'tier_spread_sanity', 'labour_minutes_sanity', 'route_correctness', 'money_exact',
  'catalogue_price_correctness', 'tenant_and_version', 'approval_required']
const ROUTES = ['awaiting_tradie_approval', 'review_required', 'inspection_required', 'clarification_required']
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const string = (v) => typeof v === 'string' && v.trim().length > 0
const integer = (v) => Number.isSafeInteger(v) && v >= 0
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const same = (a, b) => digest(a) === digest(b)
const verdict = (v) => v ? 'pass' : 'fail'
const isoDate = (v) => string(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))

export function validateFixture(fixture) {
  const errors = []
  if (fixture?.schema_version !== 2) errors.push('schema_version must be 2')
  if (!integer(fixture?.band_pct) || fixture.band_pct > 15) errors.push('band_pct must be an integer from 0 to 15')
  if (!Array.isArray(fixture?.pairs) || fixture.pairs.length === 0) return [...errors, 'pairs must be non-empty']
  const ids = new Set()
  const intakes = new Set()
  for (const [index, pair] of fixture.pairs.entries()) {
    const tag = pair?.id ?? `pair[${index}]`
    if (!string(pair?.id) || ids.has(pair.id)) errors.push(`${tag}: missing or duplicate id`)
    ids.add(pair?.id)
    if (!object(pair?.intake) || !string(pair.intake.trade) || !string(pair.intake.job_type)) errors.push(`${tag}: intake trade and job_type required`)
    if (typeof pair?.needs_grading !== 'boolean') errors.push(`${tag}: needs_grading must be explicit`)
    if (!object(pair?.expected) || !ROUTES.includes(pair.expected.route)) errors.push(`${tag}: expected route must require approval, inspection, or clarification`)
    if (pair?.needs_grading !== false) continue
    const provenance = pair.provenance
    if (!object(provenance) || provenance.classification !== 'tradie_verified' || provenance.holdout !== true ||
        !string(provenance.graded_by) || !isoDate(provenance.graded_at) || !string(provenance.source_ref)) errors.push(`${tag}: graded holdout provenance required`)
    if (!string(pair.context?.tenant_id) || !string(pair.context?.pricing_book_version_id)) errors.push(`${tag}: tenant and pricing book version required`)
    if (![0, 1000].includes(pair.context?.gst_rate_bps)) errors.push(`${tag}: context.gst_rate_bps must explicitly be 0 or 1000`)
    const inputHash = digest({ intake: pair.intake, context: pair.context })
    if (intakes.has(inputHash)) errors.push(`${tag}: duplicate intake/context cannot increase holdout coverage`)
    intakes.add(inputHash)
    if (pair.expected?.route === 'awaiting_tradie_approval' && !TIERS.some((tier) => object(pair.expected[tier]))) errors.push(`${tag}: a priced route requires at least one offered tier`)
    for (const tier of TIERS) {
      const expected = pair.expected?.[tier]
      if (!Object.hasOwn(pair.expected ?? {}, tier)) errors.push(`${tag}: expected.${tier} must be explicit, including null for an unoffered tier`)
      if (pair.expected?.route !== 'awaiting_tradie_approval') {
        if (expected != null) errors.push(`${tag}: ${tier} must be null for an unpriced route`)
        continue
      }
      if (expected === null) continue
      if (!object(expected) || !integer(expected.total_ex_gst_cents) || !integer(expected.labour_minutes)) errors.push(`${tag}: ${tier} requires integer cents and labour minutes`)
      if (!Array.isArray(expected?.material_catalogue_ids) || expected.material_catalogue_ids.some((id) => !string(id)) ||
          new Set(expected.material_catalogue_ids).size !== expected.material_catalogue_ids.length) errors.push(`${tag}: ${tier} requires unique material catalogue IDs; an empty list is allowed for labour-only work`)
      if (!Array.isArray(expected?.line_items) || expected.line_items.length === 0 || expected.line_items.some((line) =>
        !string(line?.catalogue_item_id) || !integer(line?.quantity_milli) || line.quantity_milli === 0 ||
        !integer(line?.unit_price_ex_gst_cents))) errors.push(`${tag}: ${tier} requires a catalogue BOM with positive quantity_milli and approved integer-cent unit prices`)
    }
  }
  return errors
}

function withinBand(actual, expected, pct) {
  if (!integer(actual) || !integer(expected)) return false
  const delta = BigInt(actual) > BigInt(expected) ? BigInt(actual) - BigInt(expected) : BigInt(expected) - BigInt(actual)
  return delta * 100n <= BigInt(expected) * BigInt(pct)
}

function bom(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const quantities = new Map()
  for (const line of lines) {
    if (!string(line?.catalogue_item_id) || !integer(line.quantity_milli) || line.quantity_milli === 0) return null
    const quantity = (quantities.get(line.catalogue_item_id) ?? 0) + line.quantity_milli
    if (!Number.isSafeInteger(quantity)) return null
    quantities.set(line.catalogue_item_id, quantity)
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b))
}

function exactMoney(tier) {
  if (!object(tier) || !['total_ex_gst_cents', 'gst_cents', 'total_inc_gst_cents', 'gst_rate_bps'].every((key) => integer(tier[key])) ||
      ![0, 1000].includes(tier.gst_rate_bps) || !bom(tier.line_items)) return false
  let subtotal = 0n
  for (const line of tier.line_items) {
    if (!integer(line.unit_price_ex_gst_cents) || !integer(line.line_total_ex_gst_cents)) return false
    const lineTotal = (BigInt(line.unit_price_ex_gst_cents) * BigInt(line.quantity_milli) + 500n) / 1000n
    if (lineTotal !== BigInt(line.line_total_ex_gst_cents)) return false
    subtotal += lineTotal
  }
  const gst = (subtotal * BigInt(tier.gst_rate_bps) + 5000n) / 10000n
  return subtotal === BigInt(tier.total_ex_gst_cents) && gst === BigInt(tier.gst_cents) && subtotal + gst === BigInt(tier.total_inc_gst_cents)
}

export function scorePair(pair, actual, pct) {
  const expected = pair.expected
  const dims = {
    route_correctness: verdict(actual?.route === expected.route),
    tenant_and_version: verdict(actual?.tenant_id === pair.context.tenant_id && actual?.pricing_book_version_id === pair.context.pricing_book_version_id),
    approval_required: verdict(actual?.customer_release_allowed === false && ROUTES.includes(actual?.route)),
  }
  if (expected.route !== 'awaiting_tradie_approval') {
    for (const dimension of DIMENSIONS.filter((d) => !(d in dims))) dims[dimension] = 'not_applicable'
    dims.money_exact = verdict(TIERS.every((tier) => actual?.[tier] == null))
    return dims
  }
  const offered = TIERS.filter((tier) => expected[tier] !== null)
  const noUnexpectedTiers = TIERS.filter((tier) => expected[tier] === null).every((tier) => actual?.[tier] == null)
  dims.price_within_band = verdict(offered.every((tier) => withinBand(actual?.[tier]?.total_ex_gst_cents, expected[tier].total_ex_gst_cents, pct)))
  dims.labour_minutes_sanity = verdict(offered.every((tier) => withinBand(actual?.[tier]?.labour_minutes, expected[tier].labour_minutes, pct)))
  dims.material_correctness = verdict(offered.every((tier) => {
    const ids = actual?.[tier]?.material_catalogue_ids
    return Array.isArray(ids) && ids.every(string) && new Set(ids).size === ids.length && same([...ids].sort(), [...expected[tier].material_catalogue_ids].sort())
  }))
  dims.bom_completeness = verdict(offered.every((tier) => {
    const actualBom = bom(actual?.[tier]?.line_items)
    return actualBom !== null && same(actualBom, bom(expected[tier].line_items))
  }))
  dims.catalogue_price_correctness = verdict(offered.every((tier) => {
    const lines = actual?.[tier]?.line_items
    if (!Array.isArray(lines) || lines.some((line) => !integer(line?.unit_price_ex_gst_cents))) return false
    const pricedBom = (items) => bom(items.map((line) => ({ ...line,
      catalogue_item_id: JSON.stringify([line.catalogue_item_id, line.unit_price_ex_gst_cents]) })))
    return same(pricedBom(lines), pricedBom(expected[tier].line_items))
  }))
  dims.money_exact = verdict(noUnexpectedTiers && offered.every((tier) => exactMoney(actual?.[tier]) && actual[tier].gst_rate_bps === pair.context.gst_rate_bps))
  const prices = offered.map((tier) => actual?.[tier]?.total_ex_gst_cents)
  dims.tier_spread_sanity = verdict(noUnexpectedTiers && prices.every(integer) && prices.every((price, i) => i === 0 || prices[i - 1] <= price))
  return dims
}

export function evaluateDataset({ fixture, artifact, production = false, trade = null, baseline = null }) {
  const errors = validateFixture(fixture)
  const pairs = Array.isArray(fixture?.pairs) ? fixture.pairs.filter((pair) => !trade || pair?.intake?.trade === trade) : []
  const datasetHash = digest(fixture)
  if (pairs.length === 0) errors.push('No cases selected')
  const graded = pairs.filter((pair) => pair?.needs_grading === false)
  const ungraded = pairs.length - graded.length
  const actuals = new Map()
  if (artifact) {
    if (artifact.schema_version !== 2 || artifact.dataset_sha256 !== datasetHash || !Array.isArray(artifact.results)) errors.push('Actual output artifact must be schema 2 and match the dataset SHA-256')
    if (!string(artifact.run?.source_revision) || !/^[a-f0-9]{64}$/.test(artifact.run?.config_sha256 ?? '') || !isoDate(artifact.run?.captured_at)) errors.push('Actual output run requires source_revision, config_sha256 and captured_at')
    if (production && artifact.run?.kind !== 'estimator_capture') errors.push('Production gate requires outputs captured from the estimator; synthetic fixtures are not accuracy evidence')
    for (const row of Array.isArray(artifact.results) ? artifact.results : []) {
      if (!string(row?.id) || actuals.has(row.id)) errors.push('Actual outputs contain missing or duplicate IDs')
      else actuals.set(row.id, row.actual)
      if (!fixture.pairs?.some((pair) => pair?.id === row?.id)) errors.push(`Unknown output case ${row?.id}`)
    }
  }
  const rows = errors.length ? [] : pairs.map((pair) => pair.needs_grading
    ? { id: pair.id, job_type: pair.intake.job_type, status: 'needs_grading' }
    : !artifact ? { id: pair.id, job_type: pair.intake.job_type, status: 'not_run' }
      : !actuals.has(pair.id) ? { id: pair.id, job_type: pair.intake.job_type, status: 'missing_output' }
        : { id: pair.id, job_type: pair.intake.job_type, status: 'scored', dims: scorePair(pair, actuals.get(pair.id), fixture.band_pct) })
  const scored = rows.filter((row) => row.status === 'scored')
  const summary = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, {
    pass: scored.filter((row) => row.dims[dimension] === 'pass').length,
    fail: scored.filter((row) => row.dims[dimension] === 'fail').length,
    not_applicable: scored.filter((row) => row.dims[dimension] === 'not_applicable').length,
  }]))
  const reasons = [...errors]
  if (production && graded.length < 100) reasons.push(`Production requires at least 100 graded holdouts; found ${graded.length}`)
  if (production && ungraded > 0) reasons.push(`${ungraded} selected cases still need grading`)
  if (production && !graded.some((pair) => pair.expected?.route === 'awaiting_tradie_approval')) reasons.push('No graded priced quotes: price accuracy cannot be measured')
  if ((production || artifact) && scored.length !== graded.length) reasons.push('Every selected graded case must have a scored estimator output')
  if (production && !artifact) reasons.push('Production requires estimator outputs')
  if (scored.some((row) => Object.values(row.dims).includes('fail'))) reasons.push('One or more rubric dimensions failed')
  if (baseline) {
    if (baseline.schema_version !== 2 || baseline.dataset_sha256 !== datasetHash || baseline.trade !== trade ||
        baseline.mode !== 'scored' || baseline.scored !== graded.length || !Array.isArray(baseline.rows) || baseline.rows.length !== rows.length ||
        !same(baseline.rows.map((row) => row.id).sort(), rows.map((row) => row.id).sort())) reasons.push('Baseline must score the same dataset and selected cases')
    else for (const row of rows) {
      const old = baseline.rows.find((entry) => entry.id === row.id)
      for (const dimension of DIMENSIONS) if (old.dims?.[dimension] === 'pass' && row.dims?.[dimension] !== 'pass') reasons.push(`Regression: ${row.id}/${dimension}`)
    }
  }
  return { schema_version: 2, dataset_sha256: datasetHash, trade, mode: artifact ? 'scored' : 'validation_only',
    production_gate: production, passed: reasons.length === 0,
    accuracy_measured: scored.length > 0 && artifact?.run?.kind === 'estimator_capture',
    total: pairs.length, graded: graded.length, ungraded, scored: scored.length,
    run: artifact?.run ?? null, artifact_sha256: artifact ? digest(artifact) : null, summary, rows, reasons }
}

export async function captureAdapter(fixture, adapter, trade = null) {
  const errors = validateFixture(fixture)
  if (errors.length) throw new Error(errors.join('; '))
  if (adapter?.evaluationContract?.effects !== 'read_only' || adapter.evaluationContract.environment !== 'isolated_evaluation' || typeof adapter.estimate !== 'function') throw new Error('Adapter must export estimate(input) and evaluationContract { effects: "read_only", environment: "isolated_evaluation" }')
  const results = []
  for (const pair of fixture.pairs.filter((p) => p.needs_grading === false && (!trade || p.intake.trade === trade))) {
    // Expected answers/provenance are deliberately not passed to the estimator.
    const actual = await adapter.estimate(structuredClone({ id: pair.id, intake: pair.intake, context: pair.context }))
    results.push({ id: pair.id, actual })
  }
  return { schema_version: 2, dataset_sha256: digest(fixture), run: adapter.run, results }
}

async function main(argv) {
  const values = new Set(['--pairs', '--actuals', '--adapter', '--baseline', '--report', '--capture', '--trade'])
  const switches = new Set(['--production', '--allow-adapter', '--help'])
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (values.has(flag)) {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`)
      args[flag] = argv[++index]
    } else if (switches.has(flag)) args[flag] = true
    else throw new Error(`Unknown option ${flag}; see eval/README.md`)
  }
  if (args['--help']) { console.log('node scripts/eval-quotes.mjs --pairs <json> [--actuals <json> | --adapter <module> --allow-adapter] [--trade electrical] [--production] [--baseline <report>] [--report <json>] [--capture <json>]\nSee eval/README.md. No output artifact means validation only, never production acceptance.'); return }
  if (args['--actuals'] && args['--adapter']) throw new Error('Choose actuals replay or adapter, not both')
  if (args['--adapter'] && !args['--allow-adapter']) throw new Error('Adapter execution requires --allow-adapter after reviewing its read-only contract')
  if (args['--capture'] && !args['--adapter']) throw new Error('--capture requires an adapter')
  const file = (path) => resolve(root, path)
  const read = (path) => JSON.parse(readFileSync(file(path), 'utf8'))
  const fixture = read(args['--pairs'] ?? 'eval/holdout-pairs.json')
  let artifact = args['--actuals'] ? read(args['--actuals']) : null
  if (args['--adapter']) artifact = await captureAdapter(fixture, await import(pathToFileURL(file(args['--adapter'])).href), args['--trade'])
  const report = evaluateDataset({ fixture, artifact, trade: args['--trade'] ?? null,
    production: args['--production'] === true, baseline: args['--baseline'] ? read(args['--baseline']) : null })
  // Exclusive creation protects a prior baseline/capture from accidental overwrite.
  if (args['--capture']) writeFileSync(file(args['--capture']), JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' })
  if (args['--report']) writeFileSync(file(args['--report']), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.passed ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1 })
}
