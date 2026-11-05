// The builder quote (TKO-22, D-03, DEC-025/026): a plan measurement priced as
// new work on the tenant's own new-work rates, in two tiers, rendered as a
// PDF with no payment link, and nothing written.

import { describe, expect, it, vi } from 'vitest'
import { renderPdfFromHtml } from '@/lib/pdf/gotenberg'
import { DEFAULT_ROOFING_RATE_CARD, type RoofStructureInput } from '@/lib/roofing/pricing'
import { builderQuote, builderQuoteHtml, newWorkRates, priceNewWork } from './builder-quote'
import type { RoofPlanTakeoff } from './schema'
import { fakeDb, type Row } from './test-db'

vi.mock('@/lib/pdf/gotenberg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/gotenberg')>()),
  renderPdfFromHtml: vi.fn(async () => Buffer.from('%PDF-A4')),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const RUN = '22222222-2222-4222-8222-222222222222'
const CARD = {
  ...DEFAULT_ROOFING_RATE_CARD,
  reroof_rate_per_m2: { ...DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2, cement_sheet: 95 },
  upgrade_material: 'colorbond_kliplok' as const,
  gst_registered: true,
  call_out_minimum_ex_gst: 300,
  complexity_loading_pct: 0.1,
  multi_storey_loading_pct: 0.15,
  solar_detach_reinstate_base_ex_gst: 600,
  solar_detach_reinstate_per_array_ex_gst: 300,
}
const RATES = { colorbond_corrugated: 60, colorbond_trimdek: 65, colorbond_kliplok: 80 }

const roof = (id: string, material: RoofStructureInput['inputs']['material'], sloped: number, storeys = 1): RoofStructureInput => ({
  buildingId: id, role: 'primary', label: `Roof ${id}`,
  metrics: {
    footprint_m2: sloped, sloped_area_m2: sloped, storeys, form: 'skillion', hips: 0, valleys: 0, ridge_lm: null,
    polygon_geojson: null, capture_date: null, pitch_degrees: 5, pitch_source: 'measured', area_source: 'measured',
  },
  inputs: { material, pitch: 'shallow', intent: 'full_reroof', building_year_built: null },
})

describe('newWorkRates', () => {
  it('reads the rates the tenant set for new work, and drops one that is not a positive number', () => {
    expect(newWorkRates({ rate_per_m2: { colorbond_corrugated: 60, colorbond_trimdek: -5, terracotta_tile: '90', cement_sheet: 40 } }))
      .toEqual({ colorbond_corrugated: 60 })
    expect(newWorkRates(undefined)).toEqual({})
    expect(newWorkRates({ rate_per_m2: { colorbond_corrugated: 501 } })).toEqual({})
  })
})

describe('priceNewWork', () => {
  it('prices each roof as drawn and as the upgrade, with the storey and complexity loadings, inc GST', () => {
    const priced = priceNewWork([roof('S1', 'colorbond_corrugated', 100), roof('S2', 'colorbond_trimdek', 20, 2)], CARD, RATES)
    expect(priced.ok).toBe(true)
    if (!priced.ok) return
    // S1: 100 m² × $60 × 1.10; S2: 20 m² × $65 × 1.25 (two storeys and complexity).
    expect(priced.structures.map((s) => [s.id, s.as_drawn_ex_gst, s.upgrade_ex_gst])).toEqual([['S1', 6600, 8800], ['S2', 1625, 2000]])
    expect(priced.tiers).toEqual([
      { key: 'as_drawn', label: 'As drawn', ex_gst: 8225, inc_gst: 9047.5 },
      { key: 'upgrade', label: 'Upgrade to Colorbond Klip-Lok', ex_gst: 10800, inc_gst: 11880 },
    ])
  })

  it('never prices the upgrade below the drawn roof, nor the job below the call-out minimum', () => {
    const priced = priceNewWork([roof('S1', 'colorbond_kliplok', 2)], { ...CARD, upgrade_material: 'colorbond_corrugated' }, RATES)
    expect(priced.ok && priced.tiers.map((t) => t.ex_gst)).toEqual([300, 300])
  })

  it('lists the materials without a new-work rate rather than pricing them', () => {
    expect(priceNewWork([roof('S1', 'terracotta_tile', 50), roof('S2', 'cement_sheet', 10)], CARD, RATES))
      .toEqual({ ok: false, error: 'no_new_work_rates', materials: ['terracotta_tile', 'cement_sheet'] })
  })
})

const TAKEOFF: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [2384, 1684], calibration: { method: 'dimension_string', reference_mm: 11507, factor: 35.28, delta_pct: 0.01 } },
  sheets: [{ file: 'Architectural.pdf', page: 4, number: 'A1001A', title: 'ROOF PLAN', revision: 'C', status_text: null, kind: 'roof_plan', used: true }],
  structures: [
    { id: 'S1', label: 'House 1', role: 'primary', source: 'plans', edges: [], exclusions: [], planes: [{
      id: 'S1-P1', plan_dims_mm: [10130, 9600], polygon_mm: null, plan_area_m2: 97.25, pitch_deg: 5, pitch_source: 'note', fall: null,
      profile: 'Lysaght Custom Orb', finish_tag: null, sloped_area_m2: 97.62, confidence: 'high', evidence: [],
    }] },
  ],
  scope: { includes: ['Roofing - Steel (Supply & Fit)'], excludes: ['Gutters'], questions: ['Colour?'] },
}

describe('builderQuoteHtml', () => {
  const html = builderQuoteHtml({
    branding: { businessName: 'Peppers Plumbing' }, builder: 'Example Constructions Pty Ltd', site: '59 Grange Rd, Eastern Heights QLD 4305',
    jobRef: 'J14997', jobName: 'Grange Rd dual occupancy', takeoff: TAKEOFF, date: new Date('2026-11-03T01:00:00Z'),
    priced: { ok: true, gst_registered: true, structures: [{ id: 'S1', label: 'House 1', material: 'colorbond_corrugated', area_m2: 97.62, pitch_degrees: 5, as_drawn_ex_gst: 6443, upgrade_ex_gst: 8590 }],
      tiers: [{ key: 'as_drawn', label: 'As drawn', ex_gst: 6443, inc_gst: 7087.3 }, { key: 'upgrade', label: 'Upgrade to Colorbond Klip-Lok', ex_gst: 8590, inc_gst: 9449 }] },
  })

  it('names the builder, the site, each roof, both tiers and the scope', () => {
    for (const words of ['Peppers Plumbing', 'Example Constructions Pty Ltd', '59 Grange Rd', 'J14997', 'House 1', '97.62', 'As drawn', '$7,087.30', 'Upgrade to Colorbond Klip-Lok', 'Gutters', 'Colour?', "Measured from the builder's plans"]) {
      expect(html).toContain(words)
    }
  })

  it('carries no payment link, booking or $99 visit', () => {
    expect(html).not.toMatch(/stripe|checkout|\/r\/|\/q\/|book|pay now|\$99|inspection fee/i)
  })

  it('prints its footer once, at the end, so no A4 page loses a line under it', () => {
    expect(html).toMatch(/\.accentbar,\s*\.footline\s*\{\s*position:\s*static/)
  })

  it('escapes what the drawings and the request say', () => {
    const hostile = builderQuoteHtml({ branding: { businessName: 'T' }, builder: '<script>x</script>', site: 'S', jobRef: null, jobName: null, takeoff: TAKEOFF, date: new Date(),
      priced: { ok: true, gst_registered: false, structures: [], tiers: [] } })
    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;script&gt;')
  })
})

describe('builderQuote', () => {
  const setup = (run: Row = {}, rates: unknown = { rate_per_m2: RATES }) => fakeDb({
    runs: [{ id: RUN, tenant_id: TENANT, status: 'ready', site_address: '59 Grange Rd, Eastern Heights QLD 4305', postcode: null, state: null,
      latest_extraction_id: 'X1', job_ref: 'J14997', job_name: 'Grange Rd dual occupancy', builder: { business: 'Example Constructions Pty Ltd' }, ...run }],
    extractions: [{ id: 'X1', tenant_id: TENANT, items: TAKEOFF, corrected_items: null }],
    pricingBooks: [{ id: 'PB1', tenant_id: TENANT, trade: 'roofing', overlays: { roofing_rate_card: CARD, roofing_new_work_rates: rates } }],
    tenants: [{ id: TENANT, business_name: 'Peppers Plumbing', abn: '12 345 678 901' }],
  })
  const render = vi.fn(async (html: string) => Buffer.from(`%PDF ${html.length}`))

  it('renders the run priced as new work, under the tenant\'s branding, and writes nothing', async () => {
    const fake = setup()
    const before = JSON.stringify(fake.tables)
    const outcome = await builderQuote(fake.db, { tenantId: TENANT, runId: RUN, render })
    expect(outcome).toMatchObject({ ok: true, filename: 'Builder quote J14997.pdf' })
    expect(outcome.ok && outcome.pdf.toString().startsWith('%PDF')).toBe(true)
    for (const words of ['Example Constructions Pty Ltd', 'Peppers Plumbing', 'ABN 12 345 678 901']) {
      expect(render.mock.calls.at(-1)?.[0]).toContain(words)
    }
    expect(JSON.stringify(fake.tables)).toBe(before)
  })

  it('prints on A4 pages, never the one tall page that can drop its tail', async () => {
    expect(await builderQuote(setup().db, { tenantId: TENANT, runId: RUN })).toMatchObject({ ok: true })
    expect(vi.mocked(renderPdfFromHtml)).toHaveBeenCalledWith(expect.stringContaining('Example Constructions Pty Ltd'), { singlePage: false })
  })

  it('answers pdf_unavailable when the PDF renderer fails', async () => {
    const down = vi.fn(async (): Promise<Buffer> => { throw new Error('GOTENBERG_URL is not set') })
    expect(await builderQuote(setup().db, { tenantId: TENANT, runId: RUN, render: down }))
      .toEqual({ ok: false, error: 'pdf_unavailable' })
  })

  it('refuses without new-work rates, under review without acceptance, and another tenant\'s run', async () => {
    expect(await builderQuote(setup({}, null).db, { tenantId: TENANT, runId: RUN, render }))
      .toEqual({ ok: false, error: 'no_new_work_rates', materials: ['colorbond_corrugated', 'colorbond_kliplok'] })
    expect(await builderQuote(setup({ status: 'needs_review' }).db, { tenantId: TENANT, runId: RUN, render }))
      .toEqual({ ok: false, error: 'run_not_ready', status: 'needs_review' })
    expect(await builderQuote(setup({ status: 'needs_review' }).db, { tenantId: TENANT, runId: RUN, render, acceptReview: true }))
      .toMatchObject({ ok: true })
    expect(await builderQuote(setup().db, { tenantId: '33333333-3333-4333-8333-333333333333', runId: RUN, render }))
      .toEqual({ ok: false, error: 'not_found' })
  })
})
