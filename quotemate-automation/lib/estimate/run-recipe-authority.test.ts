import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tableData = new Map<string, unknown[]>()
  let throwTable: string | null = null
  const generateText = vi.fn()
  const logErr = vi.fn()
  const from = vi.fn((table: string) => {
    if (table === throwTable) throw new Error(`authority read failed: ${table}`)
    const result = { data: tableData.get(table) ?? [], error: null }
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'or', 'limit']) {
      q[method] = vi.fn(() => q)
    }
    q.maybeSingle = vi.fn(async () => ({ data: (tableData.get(table) ?? [])[0] ?? null, error: null }))
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
    return q
  })
  return {
    tableData,
    generateText,
    from,
    logErr,
    setThrowTable: (table: string | null) => { throwTable = table },
  }
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
  id: 'book-1', tenant_id: 'tenant-1', trade: 'electrical', gst_registered: true,
  hourly_rate: 110,
  apprentice_rate: 80,
  call_out_minimum: 120,
  default_markup_pct: 25,
  min_labour_hours: 1,
}
const intake = {
  id: 'intake-1', tenant_id: 'tenant-1', trade: 'electrical', job_type: 'downlights',
  confidence: 'HIGH', inspection_required: false, address: '1 Synthetic Street, Sydney NSW',
  property: { levels: 1 },
  scope: { item_count: 1, is_new_install: true, specs: { supplied_by: 'tradie' } },
}
const assembly = { id: 'assembly-1', name: 'Install LED downlight (new install, single-storey)',
  trade: 'electrical', default_labour_hours: 1.5, price_recipe: [] }
function estimate() {
  return runEstimation(intake, pricingBook, undefined, null, { pricingBookVersionId: 'version-1' })
}
function expectAuthorityReview(result: Awaited<ReturnType<typeof runEstimation>>, reason: string) {
  expect(result.quoteCore).toMatchObject({ status: 'review_required', tenantId: 'tenant-1',
    pricingBookVersionId: 'version-1', reason: expect.stringContaining(reason) })
  expect(result.groundingHold).toBe(true)
  expect(result.inspectionCause).toBeUndefined()
  expect(result.draft).toMatchObject({ good: null, better: null, best: null,
    needs_inspection: false, pricing_path: 'deterministic' })
  expect(result.draft.risk_flags.join(' ')).toContain('[quote-core]')
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.tableData.clear()
  mocks.tableData.set('shared_assemblies', [assembly])
  mocks.setThrowTable(null)
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

afterEach(() => expect(mocks.generateText).not.toHaveBeenCalled())

describe('runEstimation recipe price authority preflight', () => {
  it('holds a present recipe with a missing tenant price instead of borrowing shared prices or charging inspection', async () => {
    mocks.tableData.set('tenant_assembly_bom', [
      { id: 'recipe-row-1', material_category: 'downlight', quantity: 1, required: true, sort: 1 },
    ])
    mocks.tableData.set('tenant_service_offerings', [{ assembly_id: assembly.id, enabled: true }])
    mocks.tableData.set('tenant_assembly_overrides', [])
    mocks.tableData.set('tenant_material_catalogue', [])
    mocks.tableData.set('shared_materials', [
      { name: 'Platform downlight', category: 'downlight', default_unit_price_ex_gst: 18 },
    ])
    mocks.tableData.set('tenant_tier_ladder', [])
    mocks.tableData.set('tenant_assembly_tasks', [])
    mocks.tableData.set('shared_assembly_tasks', [])

    const result = await estimate()
    expectAuthorityReview(result, 'missing_price')
    expect(mocks.from).toHaveBeenCalledWith('tenant_assembly_bom')
    expect(mocks.from).toHaveBeenCalledWith('tenant_material_catalogue')
    expect(result.quoteCore?.sourceSnapshot).toBeUndefined()
  })

  it('holds a missing tenant recipe without the retired model or shared-recipe fallback', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({ needs_inspection: true, inspection_reason: 'complex_scope' }),
      providerMetadata: {},
    })

    const result = await estimate()
    expectAuthorityReview(result, 'approved tenant recipe is missing')
    expect(mocks.from).toHaveBeenCalledWith('tenant_assembly_bom')
    expect(mocks.from).not.toHaveBeenCalledWith('shared_assembly_bom')
    expect(mocks.from).not.toHaveBeenCalledWith('tenant_material_catalogue')
  })

  it('holds a recipe-authority read failure without inventing a price or a site-inspection need', async () => {
    mocks.setThrowTable('shared_assemblies')

    const result = await estimate()
    expectAuthorityReview(result, 'could not be read or calculated')
    expect(mocks.from).toHaveBeenCalledWith('shared_assemblies')
    expect(mocks.from).not.toHaveBeenCalledWith('tenant_assembly_bom')
    expect(mocks.from).not.toHaveBeenCalledWith('tenant_material_catalogue')
  })
})
