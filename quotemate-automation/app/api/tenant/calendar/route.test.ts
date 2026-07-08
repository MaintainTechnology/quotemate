// GET /api/tenant/calendar — agenda + paid-but-unscheduled list.
//
// The supabase-js client is mocked at the module boundary (same chainable-
// builder pattern as trade-jobs/route.test.ts). Tests lock the regression
// that a PAID $99 inspection (pay-first → scheduled_at IS NULL) is returned
// in `toSchedule` rather than being silently dropped from the calendar.

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
    for (const op of ['select', 'eq', 'not', 'is', 'gte', 'lte', 'in', 'order', 'limit', 'maybeSingle']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (r: Result) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, getUser, client: { auth: { getUser }, from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))

import { GET } from './route'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
})

function authedUser() {
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
}

function req() {
  return new Request('http://localhost/api/tenant/calendar', {
    headers: { authorization: 'Bearer token-1' },
  })
}

describe('GET /api/tenant/calendar', () => {
  it('401 without a bearer token', async () => {
    const res = await GET(new Request('http://localhost/api/tenant/calendar'))
    expect(res.status).toBe(401)
  })

  it('404 when the user has no tenant', async () => {
    authedUser()
    h.results.push({ data: null, error: null }) // tenants lookup misses
    const res = await GET(req())
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'no_tenant' })
  })

  it('returns a paid, unscheduled inspection in toSchedule (not dropped)', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      {
        data: [
          {
            id: 'q-sched',
            share_token: 'tok-s',
            scheduled_at: '2026-07-10T02:00:00Z',
            booking_state: 'booked',
            status: 'accepted',
            paid_at: '2026-07-01T00:00:00Z',
            paid_tier: 'better',
            needs_inspection: false,
            intake_id: 'i-sched',
          },
        ],
        error: null,
      }, // scheduled quotes
      {
        data: [
          {
            id: 'q-insp',
            share_token: 'tok-i',
            scheduled_at: null,
            booking_state: 'reserved',
            status: 'paid',
            paid_at: '2026-07-04T22:14:55Z',
            paid_tier: 'inspection',
            needs_inspection: true,
            intake_id: 'i-insp',
          },
        ],
        error: null,
      }, // paid-but-unscheduled quotes
      { data: [], error: null }, // awaiting (inspection, unscheduled+unpaid) — none
      { data: null, count: 0, error: null }, // reviewCount (head:true count query)
      {
        data: [
          { id: 'i-sched', caller: { name: 'Mark', phone: '0400000000' }, job_type: 'downlights', address: null, suburb: 'Chandler', scope: { source: null } },
          { id: 'i-insp', caller: { name: 'Jon', phone: '0411111111' }, job_type: 'downlights', address: null, suburb: null, scope: null },
        ],
        error: null,
      }, // intakes join
    )

    const res = await GET(req())
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      events: Array<Record<string, unknown>>
      toSchedule: Array<Record<string, unknown>>
    }

    // Scheduled quote → agenda; paid inspection → toSchedule.
    expect(json.events).toHaveLength(1)
    expect(json.events[0]).toMatchObject({ quoteId: 'q-sched', scheduledAt: '2026-07-10T02:00:00Z' })

    expect(json.toSchedule).toHaveLength(1)
    expect(json.toSchedule[0]).toMatchObject({
      quoteId: 'q-insp',
      scheduledAt: null,
      paid: true,
      paidTier: 'inspection',
      needsInspection: true,
      customerName: 'Jon',
      customerPhone: '0411111111',
      jobType: 'downlights',
    })

    // The unscheduled query (3rd awaited: tenants, scheduled, unscheduled) must
    // filter on scheduled_at IS NULL AND paid_at IS NOT NULL, scoped to tenant.
    const unsched = h.queries[2]
    expect(unsched.table).toBe('quotes')
    expect(unsched.ops).toContainEqual({ op: 'is', args: ['scheduled_at', null] })
    expect(unsched.ops).toContainEqual({ op: 'not', args: ['paid_at', 'is', null] })
    expect(unsched.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })

    // The agenda query stays scoped + scheduled-only.
    const sched = h.queries[1]
    expect(sched.ops).toContainEqual({ op: 'not', args: ['scheduled_at', 'is', null] })
    expect(sched.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  it('500 when the agenda query errors', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: null, error: { message: 'boom' } }, // scheduled query errors
    )
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
