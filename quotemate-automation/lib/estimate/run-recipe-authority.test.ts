import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tableData = new Map<string, unknown[]>()
  const generateText = vi.fn()
  const logErr = vi.fn()
  const from = vi.fn((table: string) => {
    const result = { data: tableData.get(table) ?? [], error: null }
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'or', 'limit']) {
      q[method] = vi.fn(() => q)
    }
    q.maybeSingle = vi.fn(async () => ({ data: (tableData.get(table) ?? [])[0] ?? null, error: null }))
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return q
  })
  return { tableData, generateText, from, logErr }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: () => 'model' }))
vi.mock('ai', () => ({ generateText: mocks.generateText, stepCountIs: () => 'stop' }))
vi.mock('./prompt', () => ({ systemPrompt: vi.fn(async () => 'system') }))
vi.mock('./tools', () => ({ makeTools: vi.fn(() => ({})) }))
vi.mock('./rag', () => ({ fetchSimilarPastQuotesContext: vi.fn(async () => null) }))
vi.mock('@/lib/log/pipeline', () => ({
  pipelineLog: () => ({ ok: vi.fn(), err: mocks.logErr }),
}))
vi.mock('@/lib/log/trace', () => ({
  createTracer: () => vi.fn(),
  stopwatch: () => ({ elapsed: () => 1 }),
}))

import { runEstimation } from './run'

const pricingBook = {
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 120,
  default_markup_pct: 25,
  min_labour_hours: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tableData.clear()
  mocks.generateText.mockResolvedValue({
    text: JSON.stringify({
      good: { line_items: [], subtotal_ex_gst: 100 },
      better: { line_items: [], subtotal_ex_gst: 120 },
      best: { line_items: [], subtotal_ex_gst: 140 },
      needs_inspection: false,
    }),
    providerMetadata: {},
  })
})

describe('runEstimation recipe price authority preflight', () => {
  it('terminally routes a present recipe with a missing tenant category before Opus', async () => {
    mocks.tableData.set('shared_assemblies', [
      { id: 'assembly-1', name: 'Install LED downlight (new install, single-storey)', trade: 'electrical', default_labour_hours: 1.5 },
    ])
    mocks.tableData.set('tenant_assembly_bom', [
      { material_category: 'downlight', quantity: 1, required: true, sort: 1 },
    ])
    mocks.tableData.set('tenant_service_offerings', [])
    mocks.tableData.set('tenant_assembly_overrides', [])
    mocks.tableData.set('tenant_material_catalogue', [])
    mocks.tableData.set('shared_materials', [
      { name: 'Platform downlight', category: 'downlight', default_unit_price_ex_gst: 18 },
    ])
    mocks.tableData.set('tenant_tier_ladder', [])
    mocks.tableData.set('tenant_assembly_tasks', [])
    mocks.tableData.set('shared_assembly_tasks', [])

    const result = await runEstimation(
      { id: 'intake-1', tenant_id: 'tenant-1', trade: 'electrical', job_type: 'downlights', scope: {} },
      pricingBook,
    )

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(result.draft).toMatchObject({
      good: null,
      better: null,
      best: null,
      needs_inspection: true,
      pricing_path: 'inspection',
    })
    expect(result.draft.risk_flags).toContain('missing_tenant_recipe_price')
    expect(result.downgradedToInspection).toBe(true)
  })

  it('keeps the existing model path when there is no recipe', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({ needs_inspection: true, inspection_reason: 'complex_scope' }),
      providerMetadata: {},
    })

    const result = await runEstimation(
      { id: 'intake-2', tenant_id: 'tenant-1', trade: 'electrical', job_type: null, scope: {} },
      pricingBook,
    )

    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    expect(result.draft.needs_inspection).toBe(true)
  })
})
