import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidatePrices } from './validate'

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
    buildCandidatePrices: vi.fn(
      (): CandidatePrices => ({ material: [], assembly: [] }),
    ),
    fetchSimilarPastQuotesContext: vi.fn(async () => null),
    from,
    generateText: vi.fn(),
    makeTools: vi.fn(() => ({})),
    searchTenantStore: vi.fn(),
    systemPrompt: vi.fn(async () => 'system'),
    tableData,
    validateQuoteGrounding: vi.fn(),
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mocks.from }),
}))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: mocks.anthropic }))
vi.mock('ai', () => ({ generateText: mocks.generateText, stepCountIs: () => 'stop' }))
vi.mock('./prompt', () => ({ systemPrompt: mocks.systemPrompt }))
vi.mock('./tools', () => ({ makeTools: mocks.makeTools }))
vi.mock('./rag', () => ({ fetchSimilarPastQuotesContext: mocks.fetchSimilarPastQuotesContext }))
vi.mock('./validate', () => ({
  buildCandidatePrices: mocks.buildCandidatePrices,
  validateQuoteGrounding: mocks.validateQuoteGrounding,
}))
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
vi.mock('@/lib/log/pipeline', () => ({
  pipelineLog: () => ({ ok: vi.fn(), err: vi.fn() }),
}))
vi.mock('@/lib/log/trace', () => ({
  createTracer: () => vi.fn(),
  stopwatch: () => ({ elapsed: () => 1 }),
}))

import { runEstimation } from './run'

const BOOK = { id: 'book-1', tenant_id: 'tenant-1', trade: 'electrical', gst_registered: true,
  hourly_rate: 110, default_markup_pct: 25, min_labour_hours: 1, call_out_minimum: 0 }
function estimate(intake: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return runEstimation({ confidence: 'HIGH', address: '1 Synthetic Street, Sydney NSW', ...intake },
    { ...BOOK, ...overrides }, undefined, null, { pricingBookVersionId: 'version-1' })
}
function expectUnpricedReview(result: Awaited<ReturnType<typeof runEstimation>>) {
  expect(result.quoteCore).toMatchObject({ status: 'review_required', tenantId: 'tenant-1', pricingBookVersionId: 'version-1' })
  expect(result.groundingHold).toBe(true)
  expect(result.inspectionCause).toBeUndefined()
  expect(result.draft).toMatchObject({ good: null, better: null, best: null, needs_inspection: false })
}

const evAssemblyCandidate: CandidatePrices['assembly'][number] = {
  sourceId: 'ev-install', sourceName: 'Install EV charger', price: 400, categories: new Set(['ev_charger']),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tableData.clear()
  mocks.validateQuoteGrounding.mockReset()
  mocks.validateQuoteGrounding.mockReturnValue({ valid: true, failures: [] })
  // A mocked successful price check still needs a real category anchor for
  // the independent EV installation compatibility gate.
  mocks.buildCandidatePrices.mockReturnValue({ material: [], assembly: [evAssemblyCandidate] })
})

afterEach(() => {
  // None of these source/intent gaps authorises model monetary drafting,
  // even when a provider fixture would return a plausible repaired price.
  expect(mocks.generateText).not.toHaveBeenCalled()
  expect(mocks.anthropic).not.toHaveBeenCalled()
  expect(mocks.systemPrompt).not.toHaveBeenCalled()
  expect(mocks.makeTools).not.toHaveBeenCalled()
  expect(mocks.validateQuoteGrounding).not.toHaveBeenCalled()
  expect(mocks.fetchSimilarPastQuotesContext).not.toHaveBeenCalled()
  expect(mocks.searchTenantStore).not.toHaveBeenCalled()
})

describe('runEstimation required-inspection preflight', () => {
  it('returns the canonical inspection draft before any pricing or model path runs', async () => {
    const result = await estimate(
      {
        id: 'intake-ev-three-phase',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: { specs: { service_mode: 'install_only' } },
        property: { phase: 'three' },
        risks: [],
        inspection_required: true,
        confidence_reason: 'Three-phase work requires an on-site assessment.',
      },
      {
        hourly_rate: 110,
        default_markup_pct: 25,
      },
    )

    expect(result).toMatchObject({
      quoteCore: { status: 'inspection_required' },
      inspectionCause: 'site_conditions',
      groundingHold: false,
      draft: {
        good: null,
        better: null,
        best: null,
        needs_inspection: true,
        pricing_path: 'inspection',
        inspection_reason: expect.any(String),
      },
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.fetchSimilarPastQuotesContext).not.toHaveBeenCalled()
    expect(mocks.systemPrompt).not.toHaveBeenCalled()
    expect(mocks.makeTools).not.toHaveBeenCalled()
    expect(mocks.anthropic).not.toHaveBeenCalled()
    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.searchTenantStore).not.toHaveBeenCalled()
  })

  it('refuses an unverified tradie product pin instead of adopting its supplied price or the model draft', async () => {
    const postPinFailure = {
      tier: 'good',
      lineIndex: 1,
      description: 'Tesla Wall Connector',
      unit_price_ex_gst: 999,
      expected: 'a tenant catalogue price',
    }
    mocks.validateQuoteGrounding
      .mockReturnValueOnce({ valid: true, failures: [] })
      .mockReturnValueOnce({ valid: false, failures: [postPinFailure] })
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        good: {
          line_items: [
            {
              description: 'Install EV charger',
              source: 'assembly:ev-install',
              quantity: 1,
              unit: 'each',
              unit_price_ex_gst: 400,
              total_ex_gst: 400,
            },
          ],
          subtotal_ex_gst: 400,
        },
        better: null,
        best: null,
        needs_inspection: false,
      }),
      providerMetadata: {},
    })

    const result = await estimate(
      {
        id: 'intake-ev-pinned',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: {
          item_count: 1,
          specs: { service_mode: 'supply_and_install' },
          chosen_product: {
            catalogue_id: 'catalogue-ev-tesla',
            name: 'Tesla Wall Connector',
            price_ex_gst: 999,
            category: 'ev_charger',
            pinned_by: 'tradie',
          },
        },
        risks: [],
        inspection_required: false,
      },
      { hourly_rate: 110, default_markup_pct: 25 },
    )

    expectUnpricedReview(result)
    expect(result.quoteCore?.reason).toMatch(/assembly|job_type/)
    expect(JSON.stringify(result.draft)).not.toContain('1399')
  })

  it('keeps customer-supplied installation unpriced until a component-specific recipe exists', async () => {
    mocks.buildCandidatePrices.mockReturnValue({
      material: [
        {
          price: 800,
          sourceName: 'Tesla Wall Connector',
          sourceId: 'catalogue-ev-tesla',
          categories: new Set(['ev_charger']),
        },
      ],
      assembly: [evAssemblyCandidate],
    })
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        good: {
          line_items: [
            {
              description: 'Tesla Wall Connector',
              source: 'material:catalogue-ev-tesla',
              catalogue_id: 'catalogue-ev-tesla',
              quantity: 1,
              unit: 'each',
              unit_price_ex_gst: 800,
              total_ex_gst: 800,
            },
            {
              description: 'Install EV charger',
              source: 'assembly:ev-install',
              quantity: 1,
              unit: 'each',
              unit_price_ex_gst: 400,
              total_ex_gst: 400,
            },
            {
              description: 'Licensed electrician labour',
              source: 'labour',
              quantity: 2,
              unit: 'hr',
              unit_price_ex_gst: 100,
              total_ex_gst: 200,
            },
          ],
          subtotal_ex_gst: 1400,
        },
        better: null,
        best: null,
        needs_inspection: false,
      }),
      providerMetadata: {},
    })

    const result = await estimate(
      {
        id: 'intake-ev-customer-supply',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: { specs: { service_mode: 'install_only', supplied_by: 'customer' } },
        risks: [],
        inspection_required: false,
      },
      { hourly_rate: 100, default_markup_pct: 25 },
    )

    expectUnpricedReview(result)
    expect(result.quoteCore?.reason).toContain('component-specific recipe')
    expect(result.quoteCore?.scopeSnapshot?.scope).toMatchObject({ specs: { service_mode: 'install_only', supplied_by: 'customer' } })
  })

  it('keeps unsupported supply-only unpriced and never turns its stale inspection flag into a $99 site visit', async () => {
    mocks.buildCandidatePrices.mockReturnValue({
      material: [{
        price: 800, sourceName: 'Tesla Wall Connector', sourceId: 'catalogue-ev-tesla',
        categories: new Set(['ev_charger']),
      }],
      assembly: [evAssemblyCandidate],
    })
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        good: { line_items: [{
          description: 'Tesla Wall Connector', source: 'material:catalogue-ev-tesla',
          quantity: 1, unit: 'each', unit_price_ex_gst: 800, total_ex_gst: 800,
        }], subtotal_ex_gst: 800 },
        better: null, best: null, needs_inspection: false,
      }),
      providerMetadata: {},
    })

    const result = await estimate({
      id: 'intake-ev-supply-only', tenant_id: 'tenant-1', trade: 'electrical',
      job_type: 'ev_charger', scope: {
        specs: { service_mode: 'supply_only' },
        chosen_product: { catalogue_id: 'catalogue-ev-tesla', name: 'Tesla Wall Connector' },
      },
      property: { phase: 'three' }, risks: [], inspection_required: true,
    }, { hourly_rate: 100, default_markup_pct: 0 })

    expectUnpricedReview(result)
    expect(result.quoteCore?.reason).toContain('component-specific recipe')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('holds an unresolved or unpriced supply request without substituting inspection', async () => {
    mocks.buildCandidatePrices.mockReturnValue({ material: [], assembly: [evAssemblyCandidate] })
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        good: null, better: null, best: null, needs_inspection: true,
        inspection_reason: 'No charger price found.',
      }),
      providerMetadata: {},
    })
    const result = await estimate({
      id: 'intake-ev-supply-gap', tenant_id: 'tenant-1', trade: 'electrical',
      job_type: 'ev_charger', scope: { specs: { service_mode: 'supply_only' } },
      risks: [], inspection_required: false,
    }, { hourly_rate: 100, default_markup_pct: 0 })

    expectUnpricedReview(result)
    expect(result.draft.risk_flags.join(' ')).toContain('[quote-core]')
    expect(result.quoteCore?.reason).toContain('component-specific recipe')
  })

  it.each([undefined, 'unknown'])('holds unresolved EV service mode %s even when inspection_required is true', async serviceMode => {
    const result = await estimate({ tenant_id: 'tenant-1', trade: 'electrical', job_type: 'ev_charger',
      scope: { specs: { service_mode: serviceMode } }, inspection_required: true })
    expectUnpricedReview(result)
    expect(result.quoteCore?.reason).toContain('service mode need confirmation')
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
