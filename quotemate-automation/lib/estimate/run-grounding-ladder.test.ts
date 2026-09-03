// R9 (2026-09-02) — pipeline-level replay of the 2026-09-01 EV charger
// incident (quote 7zNJCjsaxBOL_N3cATDNvQ), plus the base-line failure case.
//
// This runs the REAL grounding validator through runEstimation — only the
// model and the DB are mocked — because the bug was never in one function: it
// was the interaction between a mis-typed row ref, a prompt-invented upsell
// price, and a downgrade that threw the whole quote away.
//
// What the incident actually produced: Opus drafted good $496.80 / better
// $591.80 / best $741.80, then three lines failed grounding and the customer
// got a $99 site-visit SMS reading "Every site is different".
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// The './validate' module is mocked above, so importing the builder from it
// would hand back the stub and silently produce an EMPTY candidate set —
// every priced line would then "fail" grounding for the wrong reason.
// importActual gives the genuine builder for constructing fixtures.
const { buildCandidatePrices: realBuildCandidatePrices } =
  await vi.importActual<typeof import('./validate')>('./validate')

const BOOK = {
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
  scope: { specs: { supplied_by: 'tradie' } },
  property: { phase: 'single' },
  risks: [],
  inspection_required: false,
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

describe('grounding ladder — 2026-09-01 EV charger incident replay (R9)', () => {
  it('prices the quote instead of downgrading it to a $99 inspection', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    // The headline: this is a PRICED quote. The incident produced the opposite.
    expect(result.downgradedToInspection).toBeFalsy()
    expect(result.groundingHold).toBeFalsy()
    expect(result.draft.needs_inspection).not.toBe(true)
    expect(result.draft.good).not.toBeNull()
    expect(result.draft.better).not.toBeNull()
    expect(result.draft.best).not.toBeNull()
    expect(result.draft.pricing_path).not.toBe('inspection')
  })

  it('R1: retags the mis-typed RCBO ref to the row it really is', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    const rcbo = result.draft.better.line_items.find((l: { description: string }) =>
      l.description.includes('RCBO'),
    )
    expect(rcbo.source).toBe(`assembly:${GPO_ASSEMBLY_ID}`)
    // Price untouched — retagging corrects the LABEL, never the money.
    expect(rcbo.unit_price_ex_gst).toBe(85)
  })

  it('R2: moves the ungrounded health check to optional_upsells and re-costs the tier', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    const bestDescriptions = result.draft.best.line_items.map(
      (l: { description: string }) => l.description,
    )
    expect(bestDescriptions).not.toContain('Switchboard health check')
    expect(result.draft.best.subtotal_ex_gst).toBe(565)
    expect(result.draft.optional_upsells).toEqual([
      { name: 'Switchboard health check', price_ex_gst: null, note: 'quoted on site' },
    ])
  })

  it('records the strip on risk_flags so the tradie can see what happened', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    expect(result.draft.risk_flags.join(' ')).toContain('[upsell-guard]')
    expect(result.draft.risk_flags.join(' ')).toContain('Switchboard health check')
  })

  it('R7: says plainly that the charger unit is supplied separately', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(incidentDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    expect(result.draft.assumptions).toContain(
      'Charger unit supplied separately — model and price confirmed before booking.',
    )
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

  it('HOLDS the priced draft for the tradie instead of nulling it to inspection', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(baseFailureDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    expect(result.groundingHold).toBe(true)
    expect(result.downgradedToInspection).toBeFalsy()
    // The tiers SURVIVE — the tradie gets something to correct, and the
    // customer is never told the site is the problem.
    expect(result.draft.good).not.toBeNull()
    expect(result.draft.good.line_items).toHaveLength(2)
    expect(result.draft.needs_inspection).not.toBe(true)
    // pricing_path must stay a LEGAL value: quotes_pricing_path_check
    // (mig 127) allows deterministic | opus_fallback | inspection only, and
    // the route dereferences quote!.id straight after the insert — so an
    // invented value here would crash the hold path in production instead of
    // holding the quote.
    expect(['deterministic', 'opus_fallback', 'inspection', undefined]).toContain(
      result.draft.pricing_path,
    )
    expect(result.draft.pricing_path).not.toBe('inspection')
  })

  it('reports the failing lines and flags the quote for review', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify(baseFailureDraft()),
      providerMetadata: {},
    })

    const result = await runEstimation(INTAKE, BOOK)

    expect(result.groundingFailures?.length).toBeGreaterThan(0)
    expect(result.draft.risk_flags.join(' ')).toContain('[grounding]')
  })
})

describe('R4 — a genuine site decision is not mislabelled (post-review fix)', () => {
  it('an intake that requires inspection reports cause site_conditions', async () => {
    const result = await runEstimation(
      {
        id: 'intake-ev-three-phase',
        tenant_id: 'tenant-atomic',
        trade: 'electrical',
        job_type: 'ev_charger',
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
    expect(result.downgradedToInspection).toBe(true)
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
    const result = await runEstimation(INTAKE, BOOK)
    // It is not an inspection at all — it is a priced draft held for review.
    expect(result.groundingHold).toBe(true)
    expect(result.inspectionCause).toBeUndefined()
  })
})
