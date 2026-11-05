import { describe, expect, it } from 'vitest'
import { estimate, evaluationContract, run } from '../scripts/eval-rank1-adapter'
import { digest, evaluateDataset } from '../scripts/eval-quotes.mjs'

/** Synthetic calculator inputs only; no actual tradie prices or grading. */
function input() {
  return {
    id: 'synthetic-adapter-case',
    intake: { tenant_id: 'tenant-unit-test', trade: 'electrical', job_type: 'downlights',
      confidence: 'HIGH', inspection_required: false, address: 'Synthetic test address',
      scope: { item_count: 1, specs: { supplied_by: 'tradie', requested_specs: {} } } },
    context: {
      tenant_id: 'tenant-unit-test', pricing_book_version_id: 'version-unit-test', gst_rate_bps: 1000,
      pricing_book: { id: 'book-unit-test', tenant_id: 'tenant-unit-test', trade: 'electrical',
        gst_registered: true, min_labour_hours: 1, call_out_minimum: 0 },
      resolved_recipe: {
        input: { bom: [{ material_category: 'downlight', quantity: 1, required: true, unit: 'ea' }],
          tenantMaterials: [{ id: 'material-unit-test', category: 'downlight', name: 'Synthetic component',
            unit: 'ea', unit_price_ex_gst: 10, active: true, is_preferred: true,
            brand: null, range_series: null, tier_hint: 'good' as const, properties: {} }],
          sharedMaterials: [], labourHours: 1, hourlyRate: 100, markupPct: 20 },
        assemblyName: 'Synthetic assembly', recipeSourceId: 'recipe-unit-test', recipeRowIds: ['bom-unit-test'],
        taskRows: { tenant: [], shared: [] },
      },
    },
  }
}

describe('actual Rank 1 evaluation adapter', () => {
  it('calls the pure runtime estimator and maps unchanged integer-cent trace', async () => {
    const fixture = input()
    const before = digest(fixture)
    const output = await estimate(fixture)
    expect(output.route).toBe('awaiting_tradie_approval')
    expect(output.customer_release_allowed).toBe(false)
    expect(output.good).toMatchObject({ total_ex_gst_cents: 11200, gst_cents: 1120,
      total_inc_gst_cents: 12320, labour_minutes: 60, material_catalogue_ids: ['tenant:material-unit-test'] })
    expect(output.good?.line_items).toEqual([
      { catalogue_item_id: 'tenant:material-unit-test', quantity_milli: 1000, unit_price_ex_gst_cents: 1200, line_total_ex_gst_cents: 1200 },
      { catalogue_item_id: 'labour:pricing_book:version-unit-test:hourly_rate', quantity_milli: 1000, unit_price_ex_gst_cents: 10000, line_total_ex_gst_cents: 10000 },
    ])
    expect(digest(fixture)).toBe(before)
  })

  it('maps unresolved service modes to review, not a priced quote or paid inspection', async () => {
    const fixture = input(); fixture.intake.scope.specs.supplied_by = 'customer'
    const output = await estimate(fixture)
    expect(output).toMatchObject({ route: 'review_required', good: null, better: null, best: null, customer_release_allowed: false })
  })

  it('preserves structured inspection and rejects a mismatched intake tenant', async () => {
    const fixture = input(); fixture.intake.inspection_required = true
    expect(await estimate(fixture)).toMatchObject({ route: 'inspection_required', good: null, better: null, best: null })
    fixture.intake.tenant_id = 'other-tenant'
    await expect(estimate(fixture)).rejects.toThrow('Intake tenant')
  })

  it('does not round unsupported time precision to manufacture a passing capture', async () => {
    const fixture = input(); fixture.context.resolved_recipe.input.labourHours = 1.000001
    await expect(estimate(fixture)).rejects.toThrow('without rounding')
  })

  it('fingerprints runtime source dependency contents, never labels a dirty tree as clean HEAD', () => {
    expect(evaluationContract).toEqual({ effects: 'read_only', environment: 'isolated_evaluation' })
    expect(run.source_revision).toMatch(/^source-sha256:[a-f0-9]{64}$/)
    expect(run.source_files['lib/estimate/rank1.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(run.source_files['lib/estimate/quote-core.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(run.source_files['lib/estimate/catalogue.ts']).toMatch(/^[a-f0-9]{64}$/)
    expect(run.source_files['lib/estimate/run.ts']).toBeUndefined()
    expect(run.source_files['pnpm-lock.yaml']).toMatch(/^[a-f0-9]{64}$/)
  })

  it('adapter output is evaluated against independently specified synthetic expectations', async () => {
    const fixture = input()
    const expectedTier = { total_ex_gst_cents: 11200, labour_minutes: 60,
      material_catalogue_ids: ['tenant:material-unit-test'], line_items: [
        { catalogue_item_id: 'tenant:material-unit-test', quantity_milli: 1000, unit_price_ex_gst_cents: 1200 },
        { catalogue_item_id: 'labour:pricing_book:version-unit-test:hourly_rate', quantity_milli: 1000, unit_price_ex_gst_cents: 10000 },
      ] }
    const dataset = { schema_version: 2, band_pct: 0, pairs: [{ ...fixture, needs_grading: false,
      provenance: { classification: 'tradie_verified', holdout: true, graded_by: 'SYNTHETIC UNIT TEST ONLY',
        graded_at: '2026-09-23T00:00:00Z', source_ref: 'synthetic arithmetic fixture, not evidence' },
      expected: { route: 'awaiting_tradie_approval', good: expectedTier, better: expectedTier, best: expectedTier } }] }
    const artifact = { schema_version: 2, dataset_sha256: digest(dataset), run: { ...run, kind: 'synthetic_test' },
      results: [{ id: fixture.id, actual: await estimate(fixture) }] }
    const report = evaluateDataset({ fixture: dataset, artifact })
    expect(report.passed).toBe(true)
    expect(report.accuracy_measured).toBe(false)
    expect(evaluateDataset({ fixture: dataset, artifact, production: true }).passed).toBe(false)
  })
})
