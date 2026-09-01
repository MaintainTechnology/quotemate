import { beforeEach, describe, expect, it, vi } from 'vitest'
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

import { INSPECTION_REASONS } from './inspection-reason'
import { runEstimation } from './run'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tableData.clear()
  mocks.validateQuoteGrounding.mockReset()
  mocks.validateQuoteGrounding.mockReturnValue({ valid: true, failures: [] })
})

describe('runEstimation required-inspection preflight', () => {
  it('returns the canonical inspection draft before any pricing or model path runs', async () => {
    const result = await runEstimation(
      {
        id: 'intake-ev-three-phase',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
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
      downgradedToInspection: true,
      draft: {
        good: null,
        better: null,
        best: null,
        needs_inspection: true,
        pricing_path: 'inspection',
        inspection_reason: INSPECTION_REASONS.switchboard,
        risk_flags: ['intake_inspection_required'],
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

  it('re-grounds a post-validation tradie pin and downgrades when its added price is ungrounded', async () => {
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

    const result = await runEstimation(
      {
        id: 'intake-ev-pinned',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: {
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

    expect(mocks.validateQuoteGrounding).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      downgradedToInspection: true,
      groundingFailures: [postPinFailure],
      draft: {
        good: null,
        better: null,
        best: null,
        needs_inspection: true,
        pricing_path: 'inspection',
      },
    })
  })

  it('removes a grounded EV unit from a customer-supplied draft and keeps the installation priced', async () => {
    mocks.buildCandidatePrices.mockReturnValue({
      material: [
        {
          price: 800,
          sourceName: 'Tesla Wall Connector',
          sourceId: 'catalogue-ev-tesla',
          categories: new Set(['ev_charger']),
        },
      ],
      assembly: [],
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

    const result = await runEstimation(
      {
        id: 'intake-ev-customer-supply',
        tenant_id: 'tenant-1',
        trade: 'electrical',
        job_type: 'ev_charger',
        scope: { specs: { supplied_by: 'customer' } },
        risks: [],
        inspection_required: false,
      },
      { hourly_rate: 100, default_markup_pct: 25 },
    )

    expect(mocks.validateQuoteGrounding).toHaveBeenCalledTimes(2)
    expect(result.downgradedToInspection).not.toBe(true)
    expect(result.draft.good).toMatchObject({
      subtotal_ex_gst: 600,
      line_items: [
        expect.objectContaining({ source: 'assembly:ev-install' }),
        expect.objectContaining({ source: 'labour' }),
      ],
    })
    expect(result.draft.good.line_items).toHaveLength(2)
  })
})
