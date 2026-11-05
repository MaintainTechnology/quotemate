import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const loadTenantRoofingPricingContext = vi.fn()
  const resolveTenantRequest = vi.fn()
  const rpc = vi.fn()

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'insert', 'update', 'eq', 'is', 'maybeSingle', 'single']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (result: Result) => unknown,
      reject?: (error: unknown) => unknown,
    ) => {
      queries.push(record)
      return Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject)
    }
    return builder
  }

  return {
    client: { from, rpc },
    rpc,
    loadTenantRoofingPricingContext,
    queries,
    resolveTenantRequest,
    results,
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: h.resolveTenantRequest }))
vi.mock('@/lib/roofing/pricing-authority', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/roofing/pricing-authority')>()
  return {
    ...actual,
    loadTenantRoofingPricingContext: h.loadTenantRoofingPricingContext,
  }
})
vi.mock('@/lib/stripe/checkout', () => ({ generateShareToken: () => 'share-new' }))
vi.mock('@/lib/quote/scope-short', () => ({
  roofingScopeShort: () => 'Server scope.',
  stampScopeShort: vi.fn(async () => undefined),
}))

import { POST } from './route'
import { persistGenericQuoteRelease } from '@/lib/quote/customer-release'

const AUTHORITY = {
  source: 'tenant_pricing_book' as const,
  tenant_id: 'tenant-1',
  pricing_book_id: 'book-1',
  revision: 'a'.repeat(64),
}

function tier(tier: 'good' | 'better' | 'best', ex_gst: number) {
  return {
    tier,
    label: tier,
    ex_gst,
    inc_gst: ex_gst * 1.1,
    scope: `${tier} server scope.`,
  }
}

function storedQuote(authority = AUTHORITY) {
  const price = {
    area_m2: 120,
    effective_rate_per_m2: 100,
    tiers: [tier('good', 8_000), tier('better', 12_000), tier('best', 15_000)],
    loadings_applied: [],
    routing: { decision: 'tradie_review', reason: 'Review the measured roof.' },
  }
  return {
    pricing_authority: authority,
    structures: [{
      buildingId: 'roof-1',
      role: 'primary',
      label: 'Main dwelling',
      metrics: {
        footprint_m2: 100,
        sloped_area_m2: 120,
        storeys: 1,
        form: 'gable',
        hips: 0,
        valleys: 0,
        ridge_lm: 10,
        polygon_geojson: null,
        capture_date: null,
      },
      inputs: {
        material: 'colorbond_corrugated',
        pitch: 'standard',
        intent: 'full_reroof',
        building_year_built: null,
      },
      price,
    }],
    combined: { area_m2: 120, tiers: price.tiers },
    routing: price.routing,
    inspection_structures: [],
  }
}

function measurement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'measurement-1',
    quote_id: null,
    quote_share_token: null,
    address: '1 Test Street, Brisbane',
    postcode: '4000',
    state: 'QLD',
    quote: storedQuote(),
    included_indices: [1],
    customer_name: 'Customer',
    customer_phone: '0400000000',
    ...overrides,
  }
}

function request(body: unknown = {
  measure_token: 'measure-token-1',
  expected_pricing_revision: AUTHORITY.revision,
}) {
  return new Request('http://localhost/api/roofing/save-as-quote', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.stubEnv('PUBLIC_WEB_ORIGIN', 'https://quotemax.com.au')
  h.results.length = 0
  h.queries.length = 0
  h.resolveTenantRequest.mockReset()
  h.loadTenantRoofingPricingContext.mockReset()
  h.rpc.mockReset().mockResolvedValue({ data: { approved: true, outbound: null, outbox_id: null }, error: null })
  h.resolveTenantRequest.mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user-1' },
    tenant: { id: 'tenant-1', business_name: 'Roof Co', trade: 'roofing' },
  })
  h.loadTenantRoofingPricingContext.mockResolvedValue({
    rateCard: {},
    authority: AUTHORITY,
  })
})

describe('actual saved roofing promotion passes strict generic customer-release authority', () => {
  async function promoted() {
    h.results.push({ data: measurement(), error: null }, { data: [{ id: 'measurement-1' }], error: null },
      { data: { id: 'intake-1' }, error: null }, { data: { id: 'quote-1', share_token: 'share-new' }, error: null },
      { data: null, error: null })
    expect((await POST(request())).status).toBe(200)
    const insert = (table: string) => h.queries.find(query => query.table === table && query.ops.some(op => op.op === 'insert'))!
      .ops.find(op => op.op === 'insert')!.args[0] as Record<string, unknown>
    const quote: Record<string, unknown> = { ...insert('quotes'), id: 'quote-1' }
    const intake: Record<string, unknown> = { ...insert('intakes'), id: 'intake-1' }
    return { quote, intake,
      tenantId: 'tenant-1', ownerId: 'owner-1', holdUntil: null }
  }
  const linked = () => measurement({ tenant_id: 'tenant-1', quote_id: 'quote-1', quote_share_token: 'share-new' })

  it('releases an initial roof quote only after verifying its exact linked server source', async () => {
    const args = await promoted()
    h.results.push({ data: linked(), error: null })
    await expect(persistGenericQuoteRelease(h.client as unknown as SupabaseClient, args))
      .resolves.toEqual({ outbound: null, outboxId: null })
    expect(h.rpc).toHaveBeenCalledWith('approve_generic_quote_release', expect.objectContaining({
      p_quote_id: 'quote-1', p_tenant_id: 'tenant-1', p_snapshot: expect.objectContaining({ better: args.quote.better }),
    }))
    const sourceRead = h.queries.at(-1)!
    for (const filter of [['tenant_id', 'tenant-1'], ['quote_id', 'quote-1'], ['quote_share_token', 'share-new']])
      expect(sourceRead.ops).toContainEqual({ op: 'eq', args: filter })
  })

  it.each(['money', 'line', 'scope', 'intake', 'tenant', 'quote_link', 'token_link', 'provenance', 'no_link'] as const)
    ('rejects tampered %s before atomic approval', async (change) => {
      const args = await promoted()
      const source = linked() as Record<string, unknown>
      const quote = args.quote as Record<string, unknown>
      const intake = args.intake as Record<string, unknown>
      if (change === 'money') quote.total_inc_gst = 1
      if (change === 'line') (quote.better as { line_items: Array<{ quantity: number }> }).line_items[0].quantity = 1
      if (change === 'scope') quote.scope_of_works = 'Different work'
      if (change === 'intake') intake.scope = { measurement_id: 'forged-measurement', pricing_authority: AUTHORITY }
      if (change === 'tenant') source.tenant_id = 'other-tenant'
      if (change === 'quote_link') source.quote_id = 'other-quote'
      if (change === 'token_link') source.quote_share_token = 'other-token'
      if (change === 'provenance') source.quote = storedQuote({ ...AUTHORITY, tenant_id: 'other-tenant' })
      h.results.push({ data: change === 'no_link' ? null : source, error: null })
      await expect(persistGenericQuoteRelease(h.client as unknown as SupabaseClient, args))
        .rejects.toMatchObject({ code: 'quote_core_review_required', status: 409 })
      expect(h.rpc).not.toHaveBeenCalled()
    })

  it('preserves an already released historical roof snapshot without requiring mutable source re-pricing', async () => {
    const args = await promoted()
    const count = h.queries.length
    await expect(persistGenericQuoteRelease(h.client as unknown as SupabaseClient,
      { ...args, quote: { ...args.quote, customer_released_at: '2026-09-01T00:00:00Z' } })).resolves.toBeDefined()
    expect(h.queries).toHaveLength(count)
  })
})

describe('POST /api/roofing/save-as-quote pricing authority', () => {
  it('rejects caller-authored price, GST, routing or provenance fields', async () => {
    const response = await POST(request({
      measure_token: 'measure-token-1',
      expected_pricing_revision: AUTHORITY.revision,
      price: { tiers: [tier('better', 1)] },
      gst: 0,
      routing: { decision: 'auto_quote' },
      pricing_authority: AUTHORITY,
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(h.queries).toEqual([])
  })

  it('fails closed when pricing setup is missing', async () => {
    h.loadTenantRoofingPricingContext.mockResolvedValue(null)
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ ok: false, error: 'tenant_pricing_required' })
    expect(h.queries).toEqual([])
  })

  it.each([
    ['stale expected revision', measurement(), 'b'.repeat(64)],
    [
      'wrong tenant authority',
      measurement({ quote: storedQuote({ ...AUTHORITY, tenant_id: 'tenant-2' }) }),
      AUTHORITY.revision,
    ],
    [
      'wrong pricing-book authority',
      measurement({ quote: storedQuote({ ...AUTHORITY, pricing_book_id: 'book-2' }) }),
      AUTHORITY.revision,
    ],
  ])('blocks %s before any promotion write', async (_label, row, expectedRevision) => {
    h.results.push({ data: row, error: null })
    const response = await POST(request({
      measure_token: 'measure-token-1',
      expected_pricing_revision: expectedRevision,
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'pricing_stale' })
    expect(h.queries.some((query) => query.ops.some((op) => op.op === 'insert'))).toBe(false)
  })

  it.each(['plans', 'hybrid'])('never promotes a %s measurement from a builder\'s plans to a customer quote', async (provider) => {
    h.results.push({ data: measurement({ provider }), error: null })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: 'plans_measurement' })
    expect(h.queries.some((query) => query.ops.some((op) => op.op === 'insert'))).toBe(false)
  })

  it.each([
    ['zero price', () => {
      const quote = storedQuote()
      quote.structures[0]!.price.tiers[1]!.ex_gst = 0
      return measurement({ quote })
    }],
    ['non-finite price', () => {
      const quote = storedQuote()
      quote.structures[0]!.price.tiers[1]!.inc_gst = Number.NaN
      return measurement({ quote })
    }],
    ['inspection route', () => {
      const quote = storedQuote()
      quote.structures[0]!.price.routing.decision = 'inspection_required'
      return measurement({ quote })
    }],
  ])('does not promote an authoritative snapshot with %s', async (_label, makeRow) => {
    h.results.push({ data: makeRow(), error: null })
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(h.queries.some((query) => query.ops.some((op) => op.op === 'insert'))).toBe(false)
  })

  it('reopen/repeated taps return the existing tenant-scoped promotion', async () => {
    h.results.push({
      data: measurement({ quote_id: 'quote-existing', quote_share_token: 'share-existing' }),
      error: null,
    }, { data: { id: 'quote-existing', share_token: 'share-existing' }, error: null }, { data: null, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      existing: true,
      quoteId: 'quote-existing',
      shareToken: 'share-existing',
    })
    expect(h.queries.some((query) => query.ops.some((op) => op.op === 'insert'))).toBe(false)
    expect(h.queries[0]!.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  it('never returns a claimed token until the tenant-owned quote exists', async () => {
    h.results.push({data:measurement({quote_share_token:'share-pending'}),error:null},{data:null,error:null})
    const response=await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ok:false,error:'promotion_pending'})
    expect(h.queries.some((q)=>q.ops.some((o)=>o.op==='insert'))).toBe(false)
  })

  it('reports lookup and link persistence failures without returning a share URL', async () => {
    h.results.push({data:measurement({quote_share_token:'share-existing'}),error:null},{data:null,error:{message:'offline'}})
    const lookup=await POST(request());expect(lookup.status).toBe(503);expect((await lookup.json()).shareUrl).toBeUndefined()
    h.results.push({data:measurement({quote_share_token:'share-existing'}),error:null},{data:{id:'quote-existing',share_token:'share-existing'},error:null},{data:null,error:{message:'offline'}})
    const release=await POST(request());expect(release.status).toBe(503);expect((await release.json()).shareUrl).toBeUndefined()
  })

  it('reconstructs and promotes the persisted server snapshot only', async () => {
    h.results.push(
      { data: measurement(), error: null },
      { data: [{ id: 'measurement-1' }], error: null },
      { data: { id: 'intake-1' }, error: null },
      { data: { id: 'quote-1', share_token: 'share-new' }, error: null },
      { data: null, error: null },
    )
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, quoteId: 'quote-1' })

    const intakeInsert = h.queries.find(
      (query) => query.table === 'intakes' && query.ops.some((op) => op.op === 'insert'),
    )
    const intake = intakeInsert?.ops.find((op) => op.op === 'insert')?.args[0] as {
      tenant_id: string
      scope: { pricing_authority: unknown }
    }
    expect(intake.tenant_id).toBe('tenant-1')
    expect(intake.scope.pricing_authority).toEqual(AUTHORITY)
    const quoteInsert = h.queries.find(
      (query) => query.table === 'quotes' && query.ops.some((op) => op.op === 'insert'),
    )
    const quote = quoteInsert?.ops.find((op) => op.op === 'insert')?.args[0] as {
      total_inc_gst: number
    }
    expect(quote.total_inc_gst).toBe(13_200)
  })
})


describe('draft promotion does not approve customer prices', () => {
  it.each([null, '2026-08-01T00:00:00Z'])('reopening a promotion preserves released_at=%s', async (releasedAt) => {
    h.results.push(
      { data: measurement({ quote_id: 'quote-existing', quote_share_token: 'share-existing', released_at: releasedAt }), error: null },
      { data: { id: 'quote-existing', share_token: 'share-existing' }, error: null },
      { data: null, error: null },
    )
    expect((await POST(request())).status).toBe(200)
    const writes = h.queries.flatMap((query) => query.ops.filter((op) => op.op === 'update'))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.args[0]).toEqual({ quote_id: 'quote-existing' })
  })

  it('saving a new editable draft leaves roofing customer release unset', async () => {
    h.results.push(
      { data: measurement({ released_at: null }), error: null },
      { data: [{ id: 'measurement-1' }], error: null },
      { data: { id: 'intake-1' }, error: null },
      { data: { id: 'quote-1', share_token: 'share-new' }, error: null },
      { data: null, error: null },
    )
    expect((await POST(request())).status).toBe(200)
    const quoteInsert = h.queries.find((query) => query.table === 'quotes')?.ops.find((op) => op.op === 'insert')
    expect(quoteInsert?.args[0]).toMatchObject({ status: 'draft' })
    for (const query of h.queries.filter((query) => query.table === 'roofing_measurements')) {
      for (const operation of query.ops.filter((op) => op.op === 'update')) {
        expect(operation.args[0]).not.toHaveProperty('released_at')
      }
    }
  })
})
