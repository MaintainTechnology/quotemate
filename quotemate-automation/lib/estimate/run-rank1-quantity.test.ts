import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const rows = new Map<string, Row[]>()
  const filters: Array<{ table: string; column: string; value: unknown }> = []
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'or', 'limit']) query[method] = () => query
    query.eq = (column: string, value: unknown) => { filters.push({ table, column, value }); return query }
    query.maybeSingle = async () => ({ data: rows.get(table)?.[0] ?? null, error: null })
    query.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows.get(table) ?? [], error: null }).then(resolve)
    return query
  })
  return { rows, from, filters, generateText: vi.fn() }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: h.from }) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: () => 'offline-model' }))
vi.mock('ai', () => ({ generateText: h.generateText, stepCountIs: () => 'stop' }))
vi.mock('./tools', () => ({ makeTools: vi.fn() }))
vi.mock('./prompt', () => ({ systemPrompt: vi.fn() }))
vi.mock('@/lib/log/pipeline', () => ({ pipelineLog: () => ({ ok: vi.fn(), err: vi.fn() }) }))
vi.mock('@/lib/log/trace', () => ({ createTracer: () => vi.fn(), stopwatch: () => ({ elapsed: () => 0 }) }))

import { runEstimation } from './run'

const book = {
  id: 'book-1', tenant_id: 'tenant-1', trade: 'electrical', gst_registered: true,
  hourly_rate: 110, default_markup_pct: 25, min_labour_hours: 1, call_out_minimum: 0,
}
const recipe = () => [
  { id: 'bom-downlight', material_category: 'downlight', quantity: 6, required: true, sort: 1, catalogue_id: 'cat-downlight' },
  { id: 'bom-sundry', material_category: 'sundries', quantity: 1, required: true, sort: 2, catalogue_id: 'cat-sundry' },
]
async function estimate(count: number, tenantId = 'tenant-1') {
  return runEstimation({
    id: 'intake-1', tenant_id: tenantId, trade: 'electrical', job_type: 'downlights',
    confidence: 'HIGH', inspection_required: false, address: '1 Test Street, Sydney NSW 2000',
    property: { levels: 1 },
    scope: { item_count: count, is_new_install: true, specs: { supplied_by: 'tradie' } },
  }, { ...book, tenant_id: tenantId }, undefined, null, { pricingBookVersionId: 'version-1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('RANK1_QUOTE_CORE_TENANTS', '')
  h.rows.clear()
  h.filters.length = 0
  h.rows.set('shared_assemblies', [{
    id: 'assembly-1', name: 'Install LED downlight (new install, single-storey)',
    trade: 'electrical', default_labour_hours: 1.5, price_recipe: [],
  }])
  h.rows.set('tenant_assembly_bom', recipe())
  h.rows.set('tenant_service_offerings', [{ assembly_id: 'assembly-1', enabled: true }])
  h.rows.set('tenant_material_catalogue', [
    { id: 'cat-downlight', category: 'downlight', name: 'Approved downlight', active: true, unit: 'each', unit_price_ex_gst: 30 },
    { id: 'cat-sundry', category: 'sundries', name: 'Approved sundries', active: true, unit: 'lot', unit_price_ex_gst: 10 },
    { id: 'cat-driver', category: 'driver', name: 'Approved driver', active: true, unit: 'each', unit_price_ex_gst: 20 },
  ])
})
afterEach(() => vi.unstubAllEnvs())

describe('strict Rank 1 recipe labour quantity boundary', () => {
  it.each(['tenant-1', 'tenant-2'])('scopes approved catalogue and recipe reads to any requesting account: %s', async tenantId => {
    const result = await estimate(6, tenantId)
    expect(result.quoteCore).toMatchObject({ status: 'priced', tenantId })
    for (const table of ['tenant_assembly_bom', 'tenant_service_offerings', 'tenant_assembly_overrides',
      'tenant_material_catalogue', 'tenant_tier_ladder']) {
      expect(h.filters).toContainEqual({ table, column: 'tenant_id', value: tenantId })
    }
    expect(h.generateText).not.toHaveBeenCalled()
  })

  it('prices the approved baseline count with its unchanged approved labour', async () => {
    const result = await estimate(6)
    expect(result.quoteCore?.status).toBe('priced')
    expect(result.quoteCore?.sourceSnapshot?.labourHours).toBe(1.5)
    expect(result.quoteCore?.sourceSnapshot?.bom[0].quantity).toBe(6)
    expect(h.generateText).not.toHaveBeenCalled()
    expect(h.rows.get('tenant_assembly_bom')).toEqual(recipe())
  })

  it.each([1, 2, 5, 7, 10, 100])('holds count %s instead of scaling materials against fixed labour', async count => {
    const result = await estimate(count)
    expect(result.quoteCore).toMatchObject({ status: 'review_required', reason: expect.stringContaining('labour baseline') })
    expect(result.draft).toMatchObject({ good: null, better: null, best: null, needs_inspection: false })
    expect(h.from).not.toHaveBeenCalledWith('tenant_material_catalogue')
    expect(h.generateText).not.toHaveBeenCalled()
  })

  it.each([1, 2, 4, 8])('uses an approved headline baseline of %s without assuming a six-item job', async count => {
    h.rows.set('tenant_assembly_bom', recipe().map(line => line.id === 'bom-downlight' ? { ...line, quantity: count } : line))
    expect((await estimate(count)).quoteCore?.status).toBe('priced')
    expect((await estimate(count + 1)).quoteCore?.status).toBe('review_required')
  })

  it('uses scaler sort/sundry/ratio semantics rather than the first recipe row', async () => {
    h.rows.set('tenant_assembly_bom', [
      { ...recipe()[1], sort: 0 },
      { id: 'bom-driver', material_category: 'driver', quantity: 2, quantity_per: '4', required: true, sort: -1, catalogue_id: 'cat-driver' },
      recipe()[0],
    ])
    const result = await estimate(6)
    expect(result.quoteCore?.status).toBe('priced')
    expect(result.quoteCore?.sourceSnapshot?.labourHours).toBe(1.5)
    expect(result.quoteCore?.sourceSnapshot?.bom.find(line => line.material_category === 'driver')?.quantity).toBe(2)
    expect((await estimate(2)).quoteCore?.reason).toContain('labour baseline')
  })

  it.each([0, -1, 0.35, '0.35', 10_001, '', 'bad', '0x04', 'Infinity', Number.NaN, Number.POSITIVE_INFINITY, true, [], {}])(
    'rejects malformed/nonpositive quantity_per %j before headline selection', async quantityPer => {
      h.rows.set('tenant_assembly_bom', [
        ...recipe(),
        { id: 'bom-driver', material_category: 'driver', quantity: 2, quantity_per: quantityPer, required: true, sort: 0, catalogue_id: 'cat-driver' },
      ])
      const result = await estimate(6)
      expect(result.quoteCore).toMatchObject({ status: 'review_required', reason: expect.stringContaining('quantity_per') })
      expect(h.from).not.toHaveBeenCalledWith('tenant_material_catalogue')
      expect(h.generateText).not.toHaveBeenCalled()
    },
  )

  it.each([0, -1, 1.5, 10_001, 'bad', '0x06', Number.NaN, Number.POSITIVE_INFINITY, true])(
    'rejects an invalid original headline quantity %j before the scaler can replace it', async quantity => {
      h.rows.set('tenant_assembly_bom', [{ ...recipe()[0], quantity }, recipe()[1]])
      const result = await estimate(6)
      expect(result.quoteCore).toMatchObject({ status: 'review_required', reason: expect.stringContaining('headline quantity') })
      expect(h.generateText).not.toHaveBeenCalled()
    },
  )

  it('holds a recipe with no headline from which to establish the labour baseline', async () => {
    h.rows.set('tenant_assembly_bom', [recipe()[1]])
    const result = await estimate(6)
    expect(result.quoteCore).toMatchObject({ status: 'review_required', reason: expect.stringContaining('headline quantity') })
    expect(h.generateText).not.toHaveBeenCalled()
  })
})
