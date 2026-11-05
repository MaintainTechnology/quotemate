import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { captureAdapter, digest, evaluateDataset, scorePair, validateFixture } from './eval-quotes.mjs'

// Arithmetic/contract fixtures ONLY. These are not prices, tradie evidence, or
// a production accuracy result. None are added to eval/holdout-pairs.json.
function pair(id = 'synthetic-1') {
  const tier = { total_ex_gst_cents: 125, labour_minutes: 60,
    material_catalogue_ids: ['test-material'], line_items: [{ catalogue_item_id: 'test-material', quantity_milli: 1000, unit_price_ex_gst_cents: 125 }] }
  return { id, needs_grading: false, intake: { trade: 'electrical', job_type: 'test', scope: { summary: id } },
    context: { tenant_id: 'test-tenant', pricing_book_version_id: 'test-version', gst_rate_bps: 1000 },
    provenance: { classification: 'tradie_verified', holdout: true, graded_by: 'SYNTHETIC UNIT TEST', graded_at: '2026-09-23T00:00:00Z', source_ref: 'synthetic unit test, not evidence' },
    expected: { route: 'awaiting_tradie_approval', good: structuredClone(tier), better: structuredClone(tier), best: structuredClone(tier) } }
}
function actual(p = pair()) {
  const tier = { total_ex_gst_cents: 125, gst_rate_bps: 1000, gst_cents: 13, total_inc_gst_cents: 138,
    labour_minutes: 60, material_catalogue_ids: ['test-material'],
    line_items: [{ catalogue_item_id: 'test-material', quantity_milli: 1000, unit_price_ex_gst_cents: 125, line_total_ex_gst_cents: 125 }] }
  return { tenant_id: p.context.tenant_id, pricing_book_version_id: p.context.pricing_book_version_id,
    route: 'awaiting_tradie_approval', customer_release_allowed: false,
    good: structuredClone(tier), better: structuredClone(tier), best: structuredClone(tier) }
}
const dataset = (...pairs) => ({ schema_version: 2, band_pct: 15, pairs })
function artifact(fixture) {
  return { schema_version: 2, dataset_sha256: digest(fixture), run: {
    kind: 'synthetic_test', source_revision: 'unit-test', config_sha256: 'a'.repeat(64), captured_at: '2026-09-23T00:00:00Z',
  }, results: fixture.pairs.map((p) => ({ id: p.id, actual: actual(p) })) }
}

test('repo placeholders validate without measuring accuracy and block production', () => {
  const fixture = JSON.parse(readFileSync(new URL('../eval/holdout-pairs.json', import.meta.url), 'utf8'))
  const report = evaluateDataset({ fixture })
  assert.equal(report.passed, true)
  assert.equal(report.accuracy_measured, false)
  assert.equal(report.graded, 0)
  const gate = evaluateDataset({ fixture, production: true })
  assert.equal(gate.passed, false)
  assert.match(gate.reasons.join('\n'), /at least 100 graded holdouts/)
})

test('fully specified controlled replay scores every priced dimension', () => {
  const fixture = dataset(pair())
  const report = evaluateDataset({ fixture, artifact: artifact(fixture) })
  assert.equal(report.passed, true)
  assert.equal(report.scored, 1)
  assert.equal(report.accuracy_measured, false, 'synthetic arithmetic fixtures are not measured production accuracy')
  assert.ok(Object.values(report.rows[0].dims).every((v) => v === 'pass'))
})

test('missing tier, missing money and NaN fail instead of skipping', () => {
  for (const invalid of [undefined, null, Number.NaN, 125.01, '125', Number.MAX_SAFE_INTEGER + 1]) {
    const output = actual()
    output.good.total_ex_gst_cents = invalid
    const result = scorePair(pair(), output, 15)
    assert.equal(result.money_exact, 'fail')
    assert.equal(result.price_within_band, 'fail')
  }
  const output = actual()
  output.good = null
  assert.equal(scorePair(pair(), output, 15).material_correctness, 'fail')
})

test('one cent GST/total drift fails even within price band', () => {
  const output = actual()
  output.good.gst_cents = 12
  output.good.total_inc_gst_cents = 137
  const result = scorePair(pair(), output, 15)
  assert.equal(result.price_within_band, 'pass')
  assert.equal(result.money_exact, 'fail')
  output.good.gst_rate_bps = 0; output.good.gst_cents = 0; output.good.total_inc_gst_cents = 125
  assert.equal(scorePair(pair(), output, 15).money_exact, 'fail', 'a self-consistent wrong tax rate is still incorrect')
})

test('missing or additional BOM items and changed quantities fail', () => {
  for (const mutate of [
    (o) => o.good.line_items.pop(),
    (o) => o.good.line_items.push({ ...o.good.line_items[0], catalogue_item_id: 'invented' }),
    (o) => { o.good.line_items[0].quantity_milli = 2000 },
  ]) {
    const output = actual(); mutate(output)
    assert.equal(scorePair(pair(), output, 15).bom_completeness, 'fail')
  }
  const output = actual(); output.good.material_catalogue_ids = ['wrong-product']
  assert.equal(scorePair(pair(), output, 15).material_correctness, 'fail')
})

test('self-consistent invented unit prices fail even inside the estimate band', () => {
  const output = actual()
  output.good.line_items[0].unit_price_ex_gst_cents = 124
  output.good.line_items[0].line_total_ex_gst_cents = 124
  output.good.total_ex_gst_cents = 124
  output.good.gst_cents = 12
  output.good.total_inc_gst_cents = 136
  const result = scorePair(pair(), output, 15)
  assert.equal(result.money_exact, 'pass')
  assert.equal(result.price_within_band, 'pass')
  assert.equal(result.catalogue_price_correctness, 'fail')
})

test('tenant, pricing version, automatic release and unsafe routes fail', () => {
  for (const [key, value, dimension] of [
    ['tenant_id', 'other-tenant', 'tenant_and_version'],
    ['pricing_book_version_id', 'stale-version', 'tenant_and_version'],
    ['customer_release_allowed', true, 'approval_required'],
    ['route', 'auto_send', 'approval_required'],
  ]) {
    const output = actual(); output[key] = value
    assert.equal(scorePair(pair(), output, 15)[dimension], 'fail')
  }
})

test('unpriced inspection/clarification has explicit N/A and forbids prices', () => {
  for (const route of ['review_required', 'inspection_required', 'clarification_required']) {
    const p = pair(); p.expected = { route, good: null, better: null, best: null }
    const output = { ...actual(p), route, good: null, better: null, best: null }
    assert.equal(scorePair(p, output, 15).price_within_band, 'not_applicable')
    assert.equal(scorePair(p, output, 15).money_exact, 'pass')
    output.best = actual().best
    assert.equal(scorePair(p, output, 15).money_exact, 'fail')
  }
})

test('confirmed product choice may offer one explicit tier without inventing others', () => {
  const p = pair(); p.expected.good = null; p.expected.best = null
  assert.deepEqual(validateFixture(dataset(p)), [])
  const output = actual(); output.good = null; output.best = null
  assert.ok(Object.values(scorePair(p, output, 15)).every((value) => value === 'pass'))
  output.best = actual().best
  assert.equal(scorePair(p, output, 15).money_exact, 'fail')
})

test('ground truth cannot be graded by flipping a placeholder flag', () => {
  const p = pair(); p.provenance = 'not verified'
  assert.match(validateFixture(dataset(p)).join('\n'), /provenance required/)
  p.provenance = pair().provenance; p.expected.good.total_ex_gst_cents = null
  assert.match(validateFixture(dataset(p)).join('\n'), /integer cents/)
})

test('duplicate holdouts, duplicate output IDs, stale artifact and missing output fail', () => {
  const p = pair(); const duplicate = { ...structuredClone(p), id: 'another-id' }
  assert.match(validateFixture(dataset(p, duplicate)).join('\n'), /duplicate intake/)
  const fixture = dataset(p)
  for (const mutate of [
    (a) => a.results.push(a.results[0]),
    (a) => { a.dataset_sha256 = 'old' },
    (a) => { a.results = [] },
    (a) => { a.results[0].id = 'unknown' },
  ]) {
    const capture = artifact(fixture); mutate(capture)
    assert.equal(evaluateDataset({ fixture, artifact: capture }).passed, false)
  }
})

test('production minimum is 100 graded cases and synthetic captures never qualify', () => {
  const fixture = dataset(...Array.from({ length: 100 }, (_, i) => pair(`synthetic-${i}`)))
  const capture = artifact(fixture)
  assert.match(evaluateDataset({ fixture, artifact: capture, production: true }).reasons.join('\n'), /synthetic fixtures/)
  // Exercise acceptance logic only; this in-memory mock is never written as evidence.
  capture.run.kind = 'estimator_capture'
  assert.equal(evaluateDataset({ fixture, artifact: capture, production: true }).passed, true)
  const smaller = dataset(...fixture.pairs.slice(0, 99))
  const smallerCapture = artifact(smaller); smallerCapture.run.kind = 'estimator_capture'
  assert.equal(evaluateDataset({ fixture: smaller, artifact: smallerCapture, production: true }).passed, false)
})

test('baseline comparison is fixture-bound and reports per-case regression', () => {
  const fixture = dataset(pair()); const capture = artifact(fixture)
  const baseline = evaluateDataset({ fixture, artifact: capture })
  capture.results[0].actual.customer_release_allowed = true
  const candidate = evaluateDataset({ fixture, artifact: capture, baseline })
  assert.match(candidate.reasons.join('\n'), /Regression: synthetic-1\/approval_required/)
  baseline.dataset_sha256 = 'different'
  assert.match(evaluateDataset({ fixture, artifact: capture, baseline }).reasons.join('\n'), /same dataset/)
})

test('injected adapter never receives expected answers or grading, and cannot mutate fixture', async () => {
  const fixture = dataset(pair()); const before = digest(fixture)
  const capture = await captureAdapter(fixture, {
    evaluationContract: { effects: 'read_only', environment: 'isolated_evaluation' },
    run: artifact(fixture).run,
    estimate: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ['context', 'id', 'intake'])
      input.intake.job_type = 'mutated adapter copy'
      return actual()
    },
  })
  assert.equal(digest(fixture), before)
  assert.equal(evaluateDataset({ fixture, artifact: capture }).passed, true)
  await assert.rejects(() => captureAdapter(fixture, { estimate: async () => actual() }), /read_only/)
})

test('CLI production rejects placeholders and legacy live flag', () => {
  const script = fileURLToPath(new URL('./eval-quotes.mjs', import.meta.url))
  const gate = spawnSync(process.execPath, [script, '--production'], { encoding: 'utf8' })
  assert.equal(gate.status, 1)
  assert.equal(JSON.parse(gate.stdout).accuracy_measured, false)
  const oldLive = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8' })
  assert.equal(oldLive.status, 1)
  assert.match(oldLive.stderr, /Unknown option --live/)
})
