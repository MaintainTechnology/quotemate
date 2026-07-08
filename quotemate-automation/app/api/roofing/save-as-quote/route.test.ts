// Spec tradie-onsite-quote-editing R6c — POST /api/roofing/save-as-quote
// accepts an optional measure_token so /m can promote a saved measurement to
// an editable quotes row: the created quote is linked back onto the
// roofing_measurements row, and a second promotion returns the existing
// quote instead of inserting a duplicate.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const getUser = vi.fn()

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'insert', 'update', 'eq', 'is', 'maybeSingle', 'single', 'limit', 'order']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, getUser, client: { auth: { getUser }, from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/stripe/checkout', () => ({ generateShareToken: () => 'share-new' }))

import { POST } from './route'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

function tier(t: 'good' | 'better' | 'best', ex: number) {
  return { tier: t, label: `${t} label`, ex_gst: ex, inc_gst: ex * 1.1, scope: `${t} scope.` }
}

function body(measureToken?: string) {
  return {
    ...(measureToken ? { measure_token: measureToken } : {}),
    address: { address: '27 Smith Street, Penrith', postcode: '2750', state: 'NSW' },
    inputs: { material: 'colorbond', pitch: '22-30', intent: 'full_reroof', building_year_built: null },
    metrics: {
      footprint_m2: 180,
      sloped_area_m2: 200,
      storeys: 1,
      form: 'hip',
      hips: 2,
      valleys: 1,
    },
    price: {
      area_m2: 200,
      effective_rate_per_m2: 95,
      tiers: [tier('good', 4000), tier('better', 20000), tier('best', 24000)],
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'ok' },
    },
  }
}

function post(payload: unknown) {
  return POST(
    new Request('http://localhost/api/roofing/save-as-quote', {
      method: 'POST',
      headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  )
}

describe('POST /api/roofing/save-as-quote with measure_token', () => {
  it('claims the measurement atomically, then links the created quote back', async () => {
    h.results.push(
      { data: { id: 'tenant-1', business_name: 'Biz' }, error: null }, // tenants
      { data: { id: 'm1', quote_id: null, quote_share_token: null }, error: null }, // measurement lookup
      { data: [{ id: 'm1' }], error: null }, // atomic claim update wins
      { data: { id: 'intake-1' }, error: null }, // intake insert
      { data: { id: 'quote-1', share_token: 'share-new' }, error: null }, // quote insert
      { data: null, error: null }, // quote_id link update
    )
    const res = await post(body('tok-m'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, shareToken: 'share-new' })

    const updates = h.queries.filter(
      (q) => q.table === 'roofing_measurements' && q.ops.some((o) => o.op === 'update'),
    )
    expect(updates, 'expected claim + link-back updates').toHaveLength(2)

    // The claim flips the NULL token conditionally — only one racer can win.
    const [claim, link] = updates
    expect(claim.ops.find((o) => o.op === 'update')!.args[0]).toMatchObject({
      quote_share_token: 'share-new',
    })
    expect(claim.ops).toContainEqual({ op: 'is', args: ['quote_share_token', null] })
    expect(claim.ops).toContainEqual({ op: 'eq', args: ['measure_token', 'tok-m'] })
    expect(claim.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })

    expect(link.ops.find((o) => o.op === 'update')!.args[0]).toMatchObject({
      quote_id: 'quote-1',
    })
    expect(link.ops).toContainEqual({ op: 'eq', args: ['quote_share_token', 'share-new'] })
  })

  // Spec quote-sync-and-roofing-workflow-fix F2 — two concurrent promotions
  // of the same measurement: the loser's conditional claim matches 0 rows, so
  // it returns the winner's quote and writes nothing. Whatever the
  // interleaving, exactly one quote exists afterwards.
  it('a promotion that loses the claim race returns the winner without inserting', async () => {
    h.results.push(
      { data: { id: 'tenant-1', business_name: 'Biz' }, error: null }, // tenants
      { data: { id: 'm1', quote_id: null, quote_share_token: null }, error: null }, // read: not yet promoted
      { data: [], error: null }, // claim matched 0 rows — another promotion won
      { data: { quote_id: 'quote-0', quote_share_token: 'share-old' }, error: null }, // re-read winner
    )
    const res = await post(body('tok-m'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, existing: true, shareToken: 'share-old' })

    const inserted = h.queries.filter((q) => q.table === 'intakes' || q.table === 'quotes')
    expect(inserted, 'the losing promotion must not insert').toHaveLength(0)
  })

  it('rolls the claim back when the insert fails, so a retry can promote', async () => {
    h.results.push(
      { data: { id: 'tenant-1', business_name: 'Biz' }, error: null }, // tenants
      { data: { id: 'm1', quote_id: null, quote_share_token: null }, error: null }, // measurement lookup
      { data: [{ id: 'm1' }], error: null }, // claim wins
      { data: null, error: { message: 'boom' } }, // intake insert fails
      { data: null, error: null }, // claim rollback update
    )
    const res = await post(body('tok-m'))
    expect(res.status).toBe(500)

    const updates = h.queries.filter(
      (q) => q.table === 'roofing_measurements' && q.ops.some((o) => o.op === 'update'),
    )
    const rollback = updates[updates.length - 1]
    expect(rollback.ops.find((o) => o.op === 'update')!.args[0]).toMatchObject({
      quote_share_token: null,
    })
    // Scoped to OUR token — never clobbers a claim another promotion stamped.
    expect(rollback.ops).toContainEqual({ op: 'eq', args: ['quote_share_token', 'share-new'] })
  })

  it('returns the existing quote on a second promotion instead of duplicating', async () => {
    h.results.push(
      { data: { id: 'tenant-1', business_name: 'Biz' }, error: null }, // tenants
      { data: { id: 'm1', quote_id: 'quote-0', quote_share_token: 'share-old' }, error: null },
    )
    const res = await post(body('tok-m'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, existing: true, shareToken: 'share-old' })

    const inserted = h.queries.filter((q) => q.table === 'intakes' || q.table === 'quotes')
    expect(inserted, 'no intakes/quotes writes on an existing promotion').toHaveLength(0)
  })

  it('still works without a measure_token (legacy measure-page flow)', async () => {
    h.results.push(
      { data: { id: 'tenant-1', business_name: 'Biz' }, error: null }, // tenants
      { data: { id: 'intake-1' }, error: null }, // intake insert
      { data: { id: 'quote-1', share_token: 'share-new' }, error: null }, // quote insert
    )
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, shareToken: 'share-new' })
    expect(h.queries.some((q) => q.table === 'roofing_measurements')).toBe(false)
  })
})
