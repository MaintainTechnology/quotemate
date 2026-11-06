// The hybrid merge (TKO-21, App Flow F6, DEC-025): the roofs the tradie names
// as existing take Geoscape's buildings, the largest first; new roofs and
// exclusions stay as drawn; C10 flags a roof both sources size that differs
// by more than 5%. The merge saves as a correction, so the checks run again.

import { describe, expect, it, vi } from 'vitest'
import type { RoofMeasuredBuilding, RoofingMultiMeasurementResult } from '@/lib/roofing/types'
import { runChecks } from './checks'
import { geoscapeMeasure, measureAndMerge, mergeAerial } from './hybrid'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'
import { fakeDb, type Row } from './test-db'

const TENANT = '11111111-1111-4111-8111-111111111111'
const RUN = '22222222-2222-4222-8222-222222222222'

type Plane = RoofPlanTakeoff['structures'][number]['planes'][number]
const plane = (id: string, over: Partial<Plane> = {}): Plane => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: null, pitch_source: null, fall: null,
  profile: 'Steel', finish_tag: null, sloped_area_m2: null, confidence: 'medium', evidence: [], ...over,
})

// Staging's Whittaker reading: the existing hipped house's four planes and the
// new laundry's one are unsized, and the deck is excluded by the scope.
const WHITTAKER: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: null, sheet_size: null, pdf_page: [2384, 1684], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures: [
    { id: 'S1', label: 'Existing house (re-roof) - hipped roof', role: 'primary', source: 'plans', edges: [], exclusions: [], planes: ['S1-P1', 'S1-P2', 'S1-P3', 'S1-P4'].map((id) => plane(id)) },
    { id: 'S2', label: 'New laundry & bathroom section roof', role: 'secondary', source: 'plans', edges: [], exclusions: [], planes: [plane('S2-P1')] },
  ],
  scope: { includes: [], excludes: ['Insulated roof over the new deck'], questions: [] },
}

const POLYGON = { type: 'Polygon' as const, coordinates: [[[152.7601, -27.6033], [152.7603, -27.6033], [152.7603, -27.6035], [152.7601, -27.6033]]] }
const building = (id: string, footprint: number, pitch: number | null = null): RoofMeasuredBuilding => ({
  buildingId: id, role: 'primary',
  metrics: {
    footprint_m2: footprint, sloped_area_m2: null, storeys: 1, form: 'hip', hips: 4, valleys: 0, ridge_lm: null,
    polygon_geojson: POLYGON, capture_date: null, pitch_degrees: pitch, pitch_source: pitch === null ? 'declared' : 'measured', area_source: 'measured',
  },
})

describe('mergeAerial', () => {
  it('gives an existing roof its building, the footprint shared over its unsized planes, and leaves the new roof and the deck', () => {
    const merged = mergeAerial(WHITTAKER, ['S1'], [building('G-shed', 18), building('G-house', 120, 22.5)])
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    const [house, laundry] = merged.takeoff.structures
    expect(house.source).toBe('hybrid')
    expect(house.aerial).toEqual({ building_id: 'G-house', footprint_m2: 120, drawn_plan_m2: null, polygon: POLYGON })
    expect(house.planes.map((p) => [p.plan_area_m2, p.pitch_deg, p.pitch_source, p.sloped_area_m2])).toEqual(
      Array(4).fill([30, 22.5, 'aerial', 32.47]),
    )
    expect(laundry).toEqual(WHITTAKER.structures[1])
    expect(merged.takeoff.scope).toEqual(WHITTAKER.scope)
    expect(RoofPlanTakeoffSchema.parse(merged.takeoff)).toEqual(merged.takeoff)
  })

  it('shares the footprint by the drawn areas when every plane has one, and keeps a pitch the drawings give', () => {
    const sized = { ...WHITTAKER, structures: [{ ...WHITTAKER.structures[0], planes: [
      plane('S1-P1', { plan_area_m2: 60, pitch_deg: 15, pitch_source: 'note' }),
      plane('S1-P2', { plan_area_m2: 40, pitch_deg: 15, pitch_source: 'note' }),
    ] }, WHITTAKER.structures[1]] }
    const merged = mergeAerial(sized, ['S1'], [building('G-house', 110, 25)])
    if (!merged.ok) throw new Error(JSON.stringify(merged))
    const house = merged.takeoff.structures[0]
    expect(house.aerial?.drawn_plan_m2).toBe(100)
    expect(house.planes.map((p) => [p.plan_area_m2, p.pitch_deg, p.pitch_source])).toEqual([[66, 15, 'note'], [44, 15, 'note']])
  })

  it('pairs the named roofs with the buildings largest first, in the order the tradie names them', () => {
    const merged = mergeAerial(WHITTAKER, ['S2', 'S1'], [building('small', 20), building('big', 100)])
    if (!merged.ok) throw new Error(JSON.stringify(merged))
    expect(merged.takeoff.structures.map((s) => s.aerial?.building_id)).toEqual(['small', 'big'])
  })

  it('takes a roof named twice once, so it keeps the largest building and leaves the next for another roof', () => {
    const merged = mergeAerial(WHITTAKER, ['S1', 'S1', 'S2'], [building('small', 20), building('big', 100)])
    if (!merged.ok) throw new Error(JSON.stringify(merged))
    expect(merged.takeoff.structures.map((s) => s.aerial?.building_id)).toEqual(['big', 'small'])
  })

  it('gives a roof read without planes one plane from its building', () => {
    const bare = { ...WHITTAKER, structures: [{ ...WHITTAKER.structures[0], planes: [] }] }
    const merged = mergeAerial(bare, ['S1'], [building('G-house', 120)])
    if (!merged.ok) throw new Error(JSON.stringify(merged))
    expect(merged.takeoff.structures[0].planes).toEqual([plane('S1-A1', { plan_area_m2: 120, profile: null })])
  })

  it('refuses a roof the takeoff lacks, and more existing roofs than buildings', () => {
    expect(mergeAerial(WHITTAKER, ['S9'], [building('G', 100)])).toEqual({ ok: false, error: 'unknown_structures', ids: ['S9'] })
    expect(mergeAerial(WHITTAKER, ['S1', 'S2'], [building('G', 100)])).toEqual({ ok: false, error: 'aerial_unmatched', ids: ['S2'] })
  })
})

describe('C10 aerial agrees', () => {
  const ctx = { scopeNote: null, schedule: [] }
  const c10 = (t: RoofPlanTakeoff) => runChecks(t, ctx).results.find((r) => r.id === 'C10')

  it('is skipped with no roof from aerial data', () => {
    expect(c10(WHITTAKER)).toMatchObject({ result: 'skipped' })
  })

  it('passes a merged roof the drawings did not size, and warns, never blocking, when the two differ by more than 5%', () => {
    const unsized = mergeAerial(WHITTAKER, ['S1'], [building('G', 120, 22.5)])
    if (!unsized.ok) throw new Error('merge failed')
    expect(c10(unsized.takeoff)).toMatchObject({ result: 'pass' })
    const sized = { ...WHITTAKER, structures: [{ ...WHITTAKER.structures[0], planes: [plane('S1-P1', { plan_area_m2: 100, pitch_deg: 20, pitch_source: 'note', sloped_area_m2: 106.42 })] }] }
    const apart = mergeAerial(sized, ['S1'], [building('G', 110)])
    if (!apart.ok) throw new Error('merge failed')
    expect(c10(apart.takeoff)).toMatchObject({ result: 'warning' })
    expect(c10(apart.takeoff)?.detail).toContain('10%')
    const withoutAerial = { ...apart.takeoff, structures: apart.takeoff.structures.map((s) => ({ ...s, aerial: undefined })) }
    expect(runChecks(apart.takeoff, ctx).status).toBe(runChecks(withoutAerial, ctx).status)
  })
})

describe('measureAndMerge', () => {
  // The tenant is on file in NSW, so a lookup in QLD shows the address's own state won.
  const setup = (run = {}, tenants: Row[] = [{ id: TENANT, state: 'NSW' }]) => fakeDb({
    runs: [{ id: RUN, tenant_id: TENANT, status: 'needs_review', site_address: '5 Whittaker St, North Ipswich QLD 4305', postcode: null, state: null,
      latest_extraction_id: 'X1', scope_note: null, checks: { schedule: [] }, job_ref: 'J14945', job_name: 'Whittaker St', builder: null, ...run }],
    extractions: [{ id: 'X1', tenant_id: TENANT, items: WHITTAKER, corrected_items: null }],
    tenants,
  })
  const found = (...buildings: RoofMeasuredBuilding[]): RoofingMultiMeasurementResult => ({ ok: true, buildings, provider: 'geoscape', warnings: [] })

  it('measures the site and saves the merge as a correction, which runs the checks again', async () => {
    const fake = setup()
    const measure = vi.fn(async () => found(building('G-house', 120, 22.5)))
    const outcome = await measureAndMerge(fake.db, { tenantId: TENANT, runId: RUN, existing: ['S1'], measure })
    expect(measure).toHaveBeenCalledWith({ address: '5 Whittaker St, North Ipswich QLD 4305', postcode: '4305', state: 'QLD' })
    expect(outcome).toMatchObject({ ok: true, run_id: RUN })
    expect(outcome.ok && outcome.checks.results.map((r) => r.id)).toContain('C10')
    const saved = fake.tables.plan_extractions[0].corrected_items as RoofPlanTakeoff
    expect(saved.structures.map((s) => s.source)).toEqual(['hybrid', 'plans'])
  })

  it("looks up a site named without its state or postcode in the tenant's own state, as TAG named Whittaker", async () => {
    const fake = setup({ site_address: '5 Whittaker Street, North Ipswich' }, [{ id: TENANT, state: 'qld' }])
    const measure = vi.fn(async () => found(building('G-house', 120, 22.5)))
    const outcome = await measureAndMerge(fake.db, { tenantId: TENANT, runId: RUN, existing: ['S1'], measure })
    // Geoscape looks an address up within its state; the postcode only gates coverage.
    expect(measure).toHaveBeenCalledWith({ address: '5 Whittaker Street, North Ipswich', postcode: '', state: 'QLD' })
    expect(outcome).toMatchObject({ ok: true, run_id: RUN })
  })

  it('is aerial_unavailable, with no call made, when neither the address nor the tenant gives a state', async () => {
    const measure = vi.fn(async () => found(building('G', 100)))
    for (const tenants of [[{ id: TENANT, state: null }], [{ id: TENANT, state: 'Queensland' }], []]) {
      const fake = setup({ site_address: '5 Whittaker Street, North Ipswich' }, tenants)
      expect(await measureAndMerge(fake.db, { tenantId: TENANT, runId: RUN, existing: ['S1'], measure }))
        .toEqual({ ok: false, error: 'aerial_unavailable', detail: 'The site address has no state to look up, and the tenant has none on file.' })
    }
    expect(measure).not.toHaveBeenCalled()
  })

  it('answers aerial_unavailable, writing nothing, when Geoscape finds nothing, fails or runs past its limit', async () => {
    for (const measure of [
      async () => ({ ok: false as const, code: 'address_not_resolved' as const, detail: 'no match' }),
      async () => { throw new Error('GEOSCAPE_API_KEY is not set') },
      () => new Promise<RoofingMultiMeasurementResult>(() => {}),
    ]) {
      const fake = setup()
      const outcome = await measureAndMerge(fake.db, { tenantId: TENANT, runId: RUN, existing: ['S1'], measure, timeoutMs: 20 })
      expect(outcome).toMatchObject({ ok: false, error: 'aerial_unavailable' })
      expect(fake.tables.plan_extractions[0].corrected_items).toBeNull()
    }
  })

  it('is aerial_unavailable without a Geoscape key, with no call made', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const outcome = await measureAndMerge(setup().db, { tenantId: TENANT, runId: RUN, existing: ['S1'], measure: geoscapeMeasure({}) })
    expect(outcome).toMatchObject({ ok: false, error: 'aerial_unavailable', detail: expect.stringContaining('GEOSCAPE_API_KEY is not set') })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('checks the named roofs before measuring, and keeps to the tenant', async () => {
    const measure = vi.fn(async () => found(building('G', 100)))
    expect(await measureAndMerge(setup().db, { tenantId: TENANT, runId: RUN, existing: ['S9'], measure }))
      .toEqual({ ok: false, error: 'unknown_structures', ids: ['S9'] })
    expect(await measureAndMerge(setup().db, { tenantId: '33333333-3333-4333-8333-333333333333', runId: RUN, existing: ['S1'], measure }))
      .toEqual({ ok: false, error: 'not_found' })
    expect(measure).not.toHaveBeenCalled()
  })
})
