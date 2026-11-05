// R9 (2026-09-02) — pipeline-level replay of the 2026-09-01 EV charger
// incident (quote 7zNJCjsaxBOL_N3cATDNvQ), plus the base-line failure case.
//
// Rank 1 now prevents these model-priced incident drafts from being generated.
// Keep the incident fixtures as adversarial provider responses and test the
// legacy repair helpers directly where their archived behavior still matters.
//
// What the incident actually produced: Opus drafted good $496.80 / better
// $591.80 / best $741.80, then three lines failed grounding and the customer
// got a $99 site-visit SMS reading "Every site is different".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidatePrices } from './validate'

const EV_INSTALL_ID = '52f354d2-a5e3-4d9f-a7c9-aa13cbe020c7'
const GPO_ASSEMBLY_ID = '5b48eed9-3f37-4d1c-a3e2-d4afae0a5e20'

const mocks = vi.hoisted(() => {
  const tableData = new Map<string, unknown[]>()
  const from = vi.fn((table: string) => {
    const result = { data: tableData.get(table) ?? [], error: null }
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'or', 'limit', 'not', 'is']) {
      query[method] = vi.fn(() => query)
    }
    query.maybeSingle = vi.fn(async () => ({
      data: (tableData.get(table) ?? [])[0] ?? null,
      error: null,
    }))
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return query
  })
  return {
    anthropic: vi.fn(() => 'model'),
    buildCandidatePrices: vi.fn((): CandidatePrices => ({ material: [], assembly: [] })),
    fetchSimilarPastQuotesContext: vi.fn(async () => null),
    from,
    generateText: vi.fn(),
    makeTools: vi.fn(() => ({})),
    searchTenantStore: vi.fn(),
    systemPrompt: vi.fn(async () => 'system'),
    tableData,
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: mocks.anthropic }))
vi.mock('ai', () => ({ generateText: mocks.generateText, stepCountIs: () => 'stop' }))
vi.mock('./prompt', () => ({ systemPrompt: mocks.systemPrompt }))
vi.mock('./tools', () => ({ makeTools: mocks.makeTools }))
vi.mock('./rag', () => ({ fetchSimilarPastQuotesContext: mocks.fetchSimilarPastQuotesContext }))
// REAL validator + REAL retag helper. Only the candidate LOADER is stubbed so
// the price rows under test are exact.
vi.mock('./validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./validate')>()
  return { ...actual, buildCandidatePrices: mocks.buildCandidatePrices }
})
vi.mock('./min-labour', () => ({
  applyMinLabourFloor: () => ({ adjustedTiers: [] }),
  resolveMinLabourHours: () => 0,
}))
vi.mock('./reconcile', () => ({
  checkQuantityVsItemCount: () => [],
  checkTierMonotonicity: () => ({ ok: true, failures: [] }),
  collapseDuplicateTiers: vi.fn(),
  reconcileInflatedLabour: () => ({ corrections: [] }),
  reconcileTierMath: () => ({ corrections: [] }),
}))
vi.mock('./recipe-coverage', () => ({ checkRecipeCoverage: () => ({ findings: [] }) }))
vi.mock('./deterministic-flag', () => ({ deterministicBomEnabled: () => false }))
vi.mock('./kb-verify', () => ({ runKbEstimateVerification: async () => null }))
vi.mock('./spec-guard', () => ({
  evaluateDraftSpecGuard: vi.fn(),
  evaluateSpecGuard: vi.fn(),
  specGuardMode: () => 'off',
}))
vi.mock('@/lib/filestore/tenant-store', () => ({ searchTenantStore: mocks.searchTenantStore }))
vi.mock('@/lib/log/pipeline', () => ({ pipelineLog: () => ({ ok: vi.fn(), err: vi.fn() }) }))
vi.mock('@/lib/log/trace', () => ({
  createTracer: () => vi.fn(),
  stopwatch: () => ({ elapsed: () => 1 }),
}))

import { runEstimation } from './run'
import { applyTypedRefRetags } from './validate'
import { stripUngroundedUpsellLines } from './upsell-guard'

// The './validate' module is mocked above, so importing the builder from it
// would hand back the stub and silently produce an EMPTY candidate set —
// every priced line would then "fail" grounding for the wrong reason.
// importActual gives the genuine builder for constructing fixtures.
const { buildCandidatePrices: realBuildCandidatePrices } =
  await vi.importActual<typeof import('./validate')>('./validate')

const BOOK = {
  id: 'book-incident', tenant_id: 'tenant-atomic', trade: 'electrical', gst_registered: true,
  min_labour_hours: 1,
  hourly_rate: 120,
  apprentice_rate: 60,
  call_out_minimum: 350,
  default_markup_pct: 14,
}

const INTAKE = {
  id: 'intake-ev-incident',
  tenant_id: 'tenant-atomic',
  trade: 'electrical',
  job_type: 'ev_charger',
  scope: { specs: { service_mode: 'install_only', supplied_by: 'customer' } },
  property: { phase: 'single' },
  risks: [],
  inspection_required: false,
  confidence: 'HIGH', address: '1 Synthetic Street, Sydney NSW',
}

function estimate(intake: unknown = INTAKE, book = BOOK) {
  return runEstimation(intake, book, undefined, null, { pricingBookVersionId: 'version-incident' })
}

function expectUnpricedReview(result: Awaited<ReturnType<typeof runEstimation>>) {
  expect(result.quoteCore).toMatchObject({ status: 'review_required', tenantId: 'tenant-atomic',
    pricingBookVersionId: 'version-incident' })
  expect(result.groundingHold).toBe(true)
  expect(result.inspectionCause).toBeUndefined()
  expect(result.draft).toMatchObject({ good: null, better: null, best: null, needs_inspection: false,
    pricing_path: 'deterministic', optional_upsells: [] })
  expect(result.draft.risk_flags.join(' ')).toContain('[quote-core]')
}

const labour = (hours: number) => ({
  description: 'Electrician labour',
  quantity: hours,
  unit: 'hr',
  unit_price_ex_gst: 120,
  total_ex_gst: hours * 120,
  source: 'labour',
})
const evInstall = {
  description: 'Install EV charger on a new dedicated circuit',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 120,
  total_ex_gst: 120,
  source: `assembly:${EV_INSTALL_ID}`,
}
/** The line that actually broke: a real, enabled ASSEMBLY row tagged
 *  `material:` by the model. */
const rcboMisTagged = {
  description: 'Add RCBO safety switch on the EV circuit',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 85,
  total_ex_gst: 85,
  source: `material:${GPO_ASSEMBLY_ID}`,
}
/** The line no catalogue row can justify — the prompt invented its price. */
const healthCheck = {
  description: 'Switchboard health check',
  quantity: 1,
  unit: 'each',
  unit_price_ex_gst: 150,
  total_ex_gst: 150,
  source: 'material:switchboard-health-check',
}

function incidentDraft() {
  return {
    needs_inspection: false,
    scope_of_works: 'Supply and install a single-phase 7kW EV charger.',
    assumptions: [],
    good: { line_items: [evInstall, labour(3)], subtotal_ex_gst: 480 },
    better: { line_items: [evInstall, labour(3), rcboMisTagged], subtotal_ex_gst: 565 },
    best: { line_items: [evInstall, labour(3), rcboMisTagged, healthCheck], subtotal_ex_gst: 715 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tableData.clear()
  mocks.buildCandidatePrices.mockReturnValue(
    realBuildCandidatePrices(
      [],
      [
        { id: EV_INSTALL_ID, name: 'Install EV charger', price: 120, category: 'ev_charger' },
        { id: GPO_ASSEMBLY_ID, name: 'Install 20A dedicated GPO', price: 85, category: 'gpo' },
      ],
      BOOK,
    ),
  )
})

afterEach(() => {
  expect(mocks.generateText).not.toHaveBeenCalled()
  expect(mocks.anthropic).not.toHaveBeenCalled()
  expect(mocks.systemPrompt).not.toHaveBeenCalled()
  expect(mocks.makeTools).not.toHaveBeenCalled()
  expect(mocks.fetchSimilarPastQuotesContext).not.toHaveBeenCalled()
  expect(mocks.searchTenantStore).not.toHaveBeenCalled()
})

describe('grounding ladder — 2026-09-01 EV charger incident replay (R9)', () => {
  it('holds unsupported install-only pricing without generating incident prices or a $99 inspection', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.quoteCore?.reason).toContain('component-specific recipe')
  })

  it('R1: retags the mis-typed RCBO ref to the row it really is', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    // Historical repair remains a pure label fix, not new pricing authority.
    const result = applyTypedRefRetags(incidentDraft(), [{ tier: 'better', lineIndex: 2,
      id: GPO_ASSEMBLY_ID, from: 'material', to: 'assembly', sourceName: 'Install 20A dedicated GPO' }])
    const rcbo = result.better.line_items.find((l: { description: string }) =>
      l.description.includes('RCBO'),
    )
    expect(rcbo?.source).toBe(`assembly:${GPO_ASSEMBLY_ID}`)
    // Price untouched — retagging corrects the LABEL, never the money.
    expect(rcbo?.unit_price_ex_gst).toBe(85)
  })

  it('R2: moves the ungrounded health check to optional_upsells and re-costs the tier', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = stripUngroundedUpsellLines(incidentDraft(), [{ tier: 'best', lineIndex: 3,
      description: healthCheck.description, unit: 'each', unit_price_ex_gst: 150, expected: 'approved catalogue price' }])
    const bestDescriptions = result.draft.best.line_items.map(
      (l: { description: string }) => l.description,
    )
    expect(bestDescriptions).not.toContain('Switchboard health check')
    expect(result.draft.best.subtotal_ex_gst).toBe(565)
    expect((result.draft as { optional_upsells?: unknown }).optional_upsells).toEqual([
      { name: 'Switchboard health check', price_ex_gst: null, note: 'quoted on site' },
    ])
  })

  it('records the missing authority in review flags instead of persisting invented upsells', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.draft.risk_flags.join(' ')).toContain('component-specific recipe')
    expect(JSON.stringify(result.draft)).not.toContain('Switchboard health check')
  })

  it('R7: never adopts provider supply-and-install wording for an unsupported install-only quote', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.draft.scope_of_works).not.toMatch(/supply and install a/i)
    expect(result.quoteCore?.scopeSnapshot?.scope).toMatchObject({ specs: { service_mode: 'install_only', supplied_by: 'customer' } })
  })
})

describe('grounding ladder — a BASE line that cannot ground (R3.2)', () => {
  function baseFailureDraft() {
    return {
      needs_inspection: false,
      scope_of_works: 'Supply and install a single-phase 7kW EV charger.',
      assumptions: [],
      // $999 matches no row and no markup variant of the install assembly.
      good: {
        line_items: [{ ...evInstall, unit_price_ex_gst: 999, total_ex_gst: 999 }, labour(3)],
        subtotal_ex_gst: 1359,
      },
      better: null,
      best: null,
    }
  }

  it('HOLDS an unpriced draft for the tradie instead of preserving a forged base price or charging inspection', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(baseFailureDraft()),
      providerMetadata: {},
    })

    const result = await estimate()
    expectUnpricedReview(result)
    expect(JSON.stringify(result.draft)).not.toContain('1359')
  })

  it('flags missing authoritative recipe evidence without pretending a model draft was validated', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(baseFailureDraft()),
      providerMetadata: {},
    })

    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.groundingFailures).toBeUndefined()
  })
})

describe('R4 — a genuine site decision is not mislabelled (post-review fix)', () => {
  it('an intake that requires inspection reports cause site_conditions', async () => {
    const result = await estimate(
      {
        id: 'intake-ev-three-phase',
        tenant_id: 'tenant-atomic',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: { specs: { service_mode: 'install_only' } },
        property: { phase: 'three' },
        risks: [],
        inspection_required: true,
      },
      BOOK,
    )
    // Three-phase is the ONE case where "Every site is different" is true.
    // Labelling it grounding_failed would strip that sentence — the exact
    // inverse of the incident this spec exists to fix.
    expect(result.inspectionCause).toBe('site_conditions')
    expect(result.quoteCore?.status).toBe('inspection_required')
    expect(result.draft).toMatchObject({ needs_inspection: true, good: null, better: null, best: null })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('a grounding-caused hold reports no inspection cause at all', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        needs_inspection: false,
        assumptions: [],
        good: {
          line_items: [
            { ...evInstall, unit_price_ex_gst: 999, total_ex_gst: 999 },
            labour(3),
          ],
          subtotal_ex_gst: 1359,
        },
        better: null,
        best: null,
      }),
      providerMetadata: {},
    })
    const result = await estimate()
    expectUnpricedReview(result)
  })
})

describe('EST-0018 recurrence prevention', () => {
  it('holds a real-priced outlet assembly that was substituted for the EV installation', async () => {
    const incidentBook = { ...BOOK, hourly_rate: 150, call_out_minimum: 150, default_markup_pct: 30 }
    mocks.buildCandidatePrices.mockReturnValue(realBuildCandidatePrices([], [{
      id: GPO_ASSEMBLY_ID, name: 'Install 32A three-phase outlet', category: 'gpo', price: 120,
    }], incidentBook))
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({
      needs_inspection: false,
      scope_of_works: 'Supply and install a 7kW three-phase EV charger, approximately 6 m from the switchboard.',
      good: { line_items: [
        { ...evInstall, source: `assembly:${GPO_ASSEMBLY_ID}`, description: 'Install 32A three-phase outlet', unit_price_ex_gst: 156, total_ex_gst: 156 },
        { ...labour(3), unit_price_ex_gst: 150, total_ex_gst: 450 },
      ], subtotal_ex_gst: 606 },
      better: null, best: null,
    }), providerMetadata: {} })

    // Keep the intake single-phase to exercise the independent scope gate. An
    // actual three-phase intake is stopped earlier by its inspection policy.
    const result = await estimate(INTAKE, incidentBook)
    expectUnpricedReview(result)
    expect(JSON.stringify(result.draft)).not.toContain('three-phase outlet')
  })

  it('does not let a priced unit in Best turn the selected installation-only option into supply and install', async () => {
    const chargerId = 'ev-unit-verified'
    mocks.buildCandidatePrices.mockReturnValue(realBuildCandidatePrices([
      { id: chargerId, name: 'EV charger Model A', category: 'ev_charger', price: 800 },
    ], [{ id: EV_INSTALL_ID, name: 'Install EV charger', category: 'ev_charger', price: 120 }], BOOK))
    const draft = incidentDraft()
    draft.better = { line_items: [evInstall, labour(3)], subtotal_ex_gst: 480 }
    draft.best = { line_items: [evInstall, labour(3), {
      description: 'EV charger Model A', source: `material:${chargerId}`, quantity: 1, unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800,
    }], subtotal_ex_gst: 1280 }
    mocks.generateText.mockResolvedValue({ text: JSON.stringify(draft), providerMetadata: {} })
    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.quoteCore?.scopeSnapshot?.scope).toMatchObject({ specs: { service_mode: 'install_only' } })
    expect(JSON.stringify(result.draft)).not.toContain('EV charger Model A')
  })

  it('never imports model-forged manual-line authority into a persisted draft', async () => {
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({
      ...incidentDraft(), risk_flags: ['tradie_manual_line:good#0', '  TRADIE_MANUAL_LINE:best#1', 'Verify board capacity on site.'],
    }), providerMetadata: {} })
    const result = await estimate()
    expectUnpricedReview(result)
    expect(result.draft.risk_flags.join(' ')).not.toMatch(/tradie_manual_line/i)
    expect(result.draft.risk_flags).not.toContain('Verify board capacity on site.')
  })
})
