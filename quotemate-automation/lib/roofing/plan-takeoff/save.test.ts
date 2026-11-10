// The price preview and the save (TKO-16, TKO-17) against the in-memory
// client: the tenant's own card, the row /m reads, and a save that happens
// twice or races another.

import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'
import { parseTenantRoofingRateCard } from '@/lib/roofing/pricing-authority'
import { denormFromSelection } from '@/lib/roofing/selection'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { previewPrice, SAVED_COLUMNS, saveTakeoff } from './save'
import type { RoofPlanTakeoff } from './schema'
import { fakeDb, type Row } from './test-db'

const TENANT = '11111111-1111-4111-8111-111111111111'
const RUN = '22222222-2222-4222-8222-222222222222'
const APP_URL = 'https://www.quotemax.com.au/'
const NOW = new Date('2026-11-03T01:00:00.000Z')

// A complete tenant-authored card: the pricing book's loader takes nothing
// less, and the default card has no cement-sheet rate.
const CARD = {
  ...DEFAULT_ROOFING_RATE_CARD,
  reroof_rate_per_m2: { ...DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2, cement_sheet: 95 },
  complexity_loading_pct: 0.15, // a fraction, as every loading is
  solar_detach_reinstate_base_ex_gst: 600,
  solar_detach_reinstate_per_array_ex_gst: 300,
}

type Plane = RoofPlanTakeoff['structures'][number]['planes'][number]
const plane = (id: string, over: Partial<Plane>): Plane => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: 97.25, pitch_deg: 5, pitch_source: 'note', fall: null,
  profile: 'Custom Orb', finish_tag: null, sloped_area_m2: null, confidence: 'high', evidence: [], ...over,
})
const takeoff = (carport: Partial<Plane> = {}): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [2384, 1684], calibration: { method: 'dimension_string', reference_mm: 11507, factor: 35.28, delta_pct: 0.01 } },
  sheets: [],
  structures: [
    { id: 'S1', label: 'House 1', role: 'primary', source: 'plans', planes: [plane('S1-P1', {})], edges: [], exclusions: [] },
    { id: 'S2', label: 'Carport', role: 'secondary', source: 'plans', planes: [plane('S2-P1', { plan_area_m2: 18.02, pitch_deg: 3, profile: 'Trimdek', ...carport })], edges: [], exclusions: [] },
  ],
  scope: { includes: [], excludes: [], questions: [] },
})

function setup(run: Row = {}, seed: { measurements?: Row[]; card?: boolean; carport?: Partial<Plane> } = {}) {
  return fakeDb({
    runs: [{ id: RUN, tenant_id: TENANT, status: 'ready', site_address: '12 Sample St, Exampleton QLD 4305', postcode: null, state: null, latest_extraction_id: 'X1', ...run }],
    extractions: [{ id: 'X1', tenant_id: TENANT, items: takeoff(seed.carport), corrected_items: null }],
    pricingBooks: seed.card === false ? [] : [{ id: 'PB1', tenant_id: TENANT, trade: 'roofing', overlays: { roofing_rate_card: CARD } }],
    measurements: seed.measurements ?? [],
  })
}
const save = (db: ReturnType<typeof setup>['db'], extra: { acceptReview?: boolean } = {}) =>
  saveTakeoff(db, { tenantId: TENANT, runId: RUN, appUrl: APP_URL, now: NOW, ...extra })

describe('previewPrice', () => {
  it('prices the takeoff on the tenant\'s own card and writes nothing', async () => {
    expect(parseTenantRoofingRateCard(CARD)).not.toBeNull()
    const { db, tables } = setup()
    const outcome = await previewPrice(db, { tenantId: TENANT, runId: RUN })
    expect(outcome).toMatchObject({ ok: true, run_id: RUN, intent: 'full_reroof', unpriced: [], pricing_authority: { pricing_book_id: 'PB1', tenant_id: TENANT } })
    if (!outcome.ok) return
    expect(outcome.quote?.structures.map((s) => [s.label, s.inputs.material])).toEqual([['House 1', 'colorbond_corrugated'], ['Carport', 'colorbond_trimdek']])
    expect([tables.roofing_measurements.length, tables.roof_takeoff_runs[0].status]).toEqual([0, 'ready'])
  })

  it('refuses another tenant\'s run, a run still being read, a tenant with no card, and an id the takeoff lacks', async () => {
    expect(await previewPrice(setup().db, { tenantId: '33333333-3333-4333-8333-333333333333', runId: RUN })).toEqual({ ok: false, error: 'not_found' })
    expect(await previewPrice(setup({ status: 'extracting', latest_extraction_id: null }).db, { tenantId: TENANT, runId: RUN })).toEqual({ ok: false, error: 'run_not_ready', status: 'extracting' })
    expect(await previewPrice(setup({}, { card: false }).db, { tenantId: TENANT, runId: RUN })).toEqual({ ok: false, error: 'no_rate_card' })
    expect(await previewPrice(setup().db, { tenantId: TENANT, runId: RUN, options: { included: ['S1', 'S7'] } })).toEqual({ ok: false, error: 'unknown_structures', ids: ['S7'] })
  })
})

describe('saveTakeoff', () => {
  it('saves one measurement for /m and marks the run saved', async () => {
    const { db, tables } = setup()
    const outcome = await save(db)
    const [row] = tables.roofing_measurements
    expect(outcome).toEqual({ ok: true, created: true, run_id: RUN, status: 'saved', measurement_id: row.id, measure_url: `https://www.quotemax.com.au/m/${row.measure_token}` })
    expect(row).toMatchObject({
      tenant_id: TENANT, provider: 'plans', source_request_key: `takeoff:${RUN}`,
      address: '12 Sample St, Exampleton QLD 4305', postcode: '4305', state: 'QLD',
      structure_count: 2, included_indices: [1, 2], routing: 'tradie_review', confirmed_at: NOW.toISOString(),
      structures: [{ buildingId: 'S1', role: 'primary', label: 'House 1' }, { buildingId: 'S2', role: 'secondary', label: 'Carport' }],
      quote: { pricing_authority: { pricing_book_id: 'PB1' } },
    })
    expect(row.public_token).toEqual(expect.any(String))
    expect(row.measure_token).toEqual(expect.any(String))
    // Nothing a customer page releases, and no one's name.
    expect(['released_at', 'customer_name', 'customer_phone'].filter((column) => column in row)).toEqual([])
    // The list views' summary is the one the website derives from the same selection.
    const denorm = denormFromSelection(row.quote as MultiRoofQuote, row.included_indices as number[])
    expect([row.combined_area_m2, row.combined_better_inc_gst]).toEqual([denorm.combined_area_m2, denorm.combined_better_inc_gst])
    expect(tables.roof_takeoff_runs[0]).toMatchObject({ status: 'saved', roofing_measurement_id: row.id })
  })

  it('saves a run with a roof merged from aerial data as a hybrid, with its building outline (TKO-21)', async () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[152.7601, -27.6033], [152.7603, -27.6033], [152.7603, -27.6035], [152.7601, -27.6033]]] }
    const merged = takeoff()
    merged.structures[0] = { ...merged.structures[0], source: 'hybrid', aerial: { building_id: 'G1', footprint_m2: 97.25, drawn_plan_m2: null, polygon } }
    const hybrid = setup()
    hybrid.tables.plan_extractions[0].items = merged
    await save(hybrid.db)
    expect(hybrid.tables.roofing_measurements[0].provider).toBe('hybrid')
    expect(JSON.stringify(hybrid.tables.roofing_measurements[0].quote)).toContain('152.7603')
    // Saved without the merged roof, the measurement is the plans' alone.
    const plansOnly = setup()
    plansOnly.tables.plan_extractions[0].items = merged
    await saveTakeoff(plansOnly.db, { tenantId: TENANT, runId: RUN, appUrl: APP_URL, now: NOW, options: { included: ['S2'] } })
    expect(plansOnly.tables.roofing_measurements[0].provider).toBe('plans')
  })

  it('writes exactly the columns the readiness check selects', async () => {
    // The service's readiness probe selects SAVED_COLUMNS, so a column
    // production lacks (as it lacked source_request_key until migration 224)
    // fails readiness at deploy, not a tradie's save.
    const { db, tables } = setup()
    await save(db)
    // The database's own defaults aren't written by the save.
    const written = Object.keys(tables.roofing_measurements[0]).filter((column) => !['id', 'created_at'].includes(column))
    expect(written.sort()).toEqual([...SAVED_COLUMNS].sort())
  })

  it('returns the same row on a second save, and to a save that lost the race for the key', async () => {
    const { db, tables } = setup()
    const first = await save(db)
    expect(await save(db)).toEqual({ ...first, created: false })
    expect(tables.roofing_measurements).toHaveLength(1)

    const winner = { id: 'M-won', tenant_id: TENANT, source_request_key: `takeoff:${RUN}`, measure_token: 'won' }
    const raced = setup({}, { measurements: [winner] })
    expect(await save(raced.db)).toMatchObject({ ok: true, created: false, measurement_id: 'M-won', measure_url: 'https://www.quotemax.com.au/m/won' })
    expect(raced.tables.roofing_measurements).toHaveLength(1)
    expect(raced.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'saved', roofing_measurement_id: 'M-won' })
  })

  it('saves a run under review only when the tradie accepts it', async () => {
    const { db, tables } = setup({ status: 'needs_review' })
    expect(await save(db)).toEqual({ ok: false, error: 'run_not_ready', status: 'needs_review' })
    expect(tables.roofing_measurements).toHaveLength(0)
    expect(await save(db, { acceptReview: true })).toMatchObject({ ok: true, created: true })
  })

  it('refuses while a roof can\'t be priced, and writes nothing', async () => {
    const { db, tables } = setup({}, { carport: { plan_area_m2: null } })
    expect(await save(db)).toEqual({ ok: false, error: 'unpriceable', structures: [{ structure_id: 'S2', reason: 'No area for S2-P1' }] })
    expect([tables.roofing_measurements.length, tables.roof_takeoff_runs[0].status]).toEqual([0, 'ready'])
  })

  it('saves a saved run again once the website has deleted its measurement', async () => {
    const { db, tables } = setup({ status: 'saved', roofing_measurement_id: null })
    expect(await save(db)).toMatchObject({ ok: true, created: true })
    expect(tables.roofing_measurements).toHaveLength(1)
  })
})
