// Spec specs/tradie-booking-notifications.md AC4/AC5 — the tradie is told when
// a roofing or painting customer picks a slot.
//
// Live 2026-07-27: token ff6f67ce… took a $69,652 quote, a paid deposit and a
// Fri 31 Jul 12:00pm booking, and the tradie's phone stayed silent. This route
// texted only the customer; the quotes funnel has notified both sides since
// lib/quote/booking-notify.ts.
//
// The price assertion is the sharp one: the customer picked ONE of three
// buildings, so the alert must carry the SERVED total, never the combined
// property total sitting on combined_better_inc_gst.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MultiRoofQuote, RoofStructurePrice, RoofStructureRole } from '@/lib/roofing/types'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'maybeSingle']) {
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

  // after() bodies are async. Calling them inline is not enough — the awaits
  // inside settle on later microtasks, so assertions would run before the
  // sends happen. Collect the promises and let each test await them.
  const deferred: Promise<unknown>[] = []

  return { results, queries, deferred, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => void h.deferred.push(Promise.resolve().then(fn)),
}))

/** POST, then drain the deferred after() work the route scheduled. */
async function post(trade = 'roof', slot: string = SLOT) {
  const res = await POST(req(slot), ctx(trade))
  await Promise.allSettled(h.deferred)
  return res
}
vi.mock('@/lib/quote/trade-booking', async (orig) => ({
  ...(await orig<typeof import('@/lib/quote/trade-booking')>()),
  loadTenantBookingOptions: vi.fn(async () => [
    { iso: '2026-07-31T02:00:00.000Z', period: 'PM', label: 'Fri 31 Jul PM' },
  ]),
}))
vi.mock('@/lib/sms/dispatch', () => ({
  dispatchQuoteMessage: vi.fn(async () => ({ ok: true, channel: 'sms', sid: 'SM1' })),
}))
vi.mock('@/lib/sms/roofing-notify', () => ({
  notifyRoofingTradie: vi.fn(async () => ({ notified: true })),
}))

import { POST } from './route'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { notifyRoofingTradie } from '@/lib/sms/roofing-notify'

// ── a real 3-building quote, so the narrowing is exercised not mocked ──
function tier(name: 'good' | 'better' | 'best', ex: number) {
  return { tier: name, label: name, ex_gst: ex, inc_gst: Math.round(ex * 1.1 * 100) / 100, scope: name }
}
function struct(role: RoofStructureRole, area: number, base: number): RoofStructurePrice {
  return {
    buildingId: `b-${area}`,
    role,
    label: role === 'primary' ? 'Main dwelling' : 'Secondary structure',
    metrics: {
      footprint_m2: area, sloped_area_m2: area, storeys: 1, form: 'hip',
      hips: 2, valleys: 1, ridge_lm: 10, polygon_geojson: null, capture_date: null,
    },
    inputs: { material: 'colorbond_corrugated', pitch: 'standard', intent: 'full_reroof' },
    price: {
      area_m2: area,
      effective_rate_per_m2: base / area,
      tiers: [tier('good', base * 0.5), tier('better', base), tier('best', base * 1.5)],
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'ok' },
    },
  }
}
// better inc_gst: 69,652 + 33,000 + 12,650 — the customer picked #1 only.
const ROOF_QUOTE: MultiRoofQuote = {
  structures: [struct('primary', 586, 63320), struct('secondary', 383, 30000), struct('secondary', 33, 11500)],
  combined: { area_m2: 1002, tiers: [tier('good', 52410), tier('better', 104820), tier('best', 157230)] },
  routing: { decision: 'tradie_review', reason: 'ok' },
  inspection_structures: [],
}

const SLOT = '2026-07-31T02:00:00.000Z'
const ROOF_ROW = {
  id: 'm1',
  tenant_id: 't1',
  paid_at: '2026-07-27T03:25:11.729Z',
  scheduled_at: null,
  customer_name: null,
  customer_phone: '+61480808517',
  address: '670 London Rd, Chandler QLD 4155',
  quote: ROOF_QUOTE,
  included_indices: [1],
  confirmed_structure: null,
  // If the route ever reads the denormalised column instead of narrowing,
  // this is the wrong number it would send.
  combined_better_inc_gst: 115117,
}
const TENANT = {
  twilio_sms_number: '+61468048422',
  state: 'QLD',
  owner_mobile: '+61400111222',
  owner_first_name: 'Jeph',
}

const req = (slot: string = SLOT) =>
  new Request('http://localhost/api/q/book/roof/tok', {
    method: 'POST',
    body: JSON.stringify({ slot }),
  })
const ctx = (trade = 'roof', token = 'tok') => ({ params: Promise.resolve({ trade, token }) })

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.deferred.length = 0
  vi.mocked(dispatchQuoteMessage).mockClear()
  vi.mocked(notifyRoofingTradie).mockClear()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-28T00:00:00.000Z'))
})

describe('AC4 the tradie is notified when the customer books', () => {
  it('sends the SERVED total, not the combined property total', async () => {
    h.results.push({ data: ROOF_ROW, error: null })     // row lookup
    h.results.push({ data: null, error: null })          // scheduled_at update
    h.results.push({ data: TENANT, error: null })        // tenant lookup in after()

    const res = await post()
    expect(await res.json()).toMatchObject({ ok: true, scheduled_at: SLOT })

    expect(notifyRoofingTradie).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyRoofingTradie).mock.calls[0][0]).toMatchObject({
      kind: 'booking_confirmed',
      customerPhone: '+61480808517',
      address: '670 London Rd, Chandler QLD 4155',
      betterIncGst: 69652,
      scheduledAt: SLOT,
      timeZone: 'Australia/Brisbane',
      tradeLabel: 'roofing',
      tenant: expect.objectContaining({ owner_mobile: '+61400111222', owner_first_name: 'Jeph' }),
    })
  })

  it('still texts the customer, and the tradie alert is a second send', async () => {
    h.results.push({ data: ROOF_ROW, error: null })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    await post()
    expect(dispatchQuoteMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(dispatchQuoteMessage).mock.calls[0][0]).toMatchObject({
      to: '+61480808517',
    })
  })

  it('stamps tenant_id on the audit row so alerts read back per tenant', async () => {
    h.results.push({ data: ROOF_ROW, error: null })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    await post()
    const sent = vi.mocked(notifyRoofingTradie).mock.calls[0][0] as {
      dispatch: (o: { to: string; text: string }) => Promise<unknown>
    }
    await sent.dispatch({ to: '+61400111222', text: 'x' })
    expect(vi.mocked(dispatchQuoteMessage).mock.calls.at(-1)?.[0]).toMatchObject({
      audience: 'tradie',
      tenantId: 't1',
    })
  })

  it('a job with no customer number still alerts, without an empty Customer line', async () => {
    h.results.push({ data: { ...ROOF_ROW, customer_phone: null }, error: null })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    await post()
    expect(vi.mocked(notifyRoofingTradie).mock.calls[0][0].customerPhone).toBeTruthy()
  })

  it('painting books through the same handler and says painting', async () => {
    h.results.push({
      data: { ...ROOF_ROW, quote: undefined, included_indices: undefined, better_inc_gst: 8400 },
      error: null,
    })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    await post('paint')
    expect(vi.mocked(notifyRoofingTradie).mock.calls[0][0]).toMatchObject({
      tradeLabel: 'painting',
      betterIncGst: 8400,
    })
  })
})

describe('AC5 a failed alert never undoes the booking', () => {
  it('returns ok and keeps the slot when the notify throws', async () => {
    vi.mocked(notifyRoofingTradie).mockRejectedValueOnce(new Error('twilio down'))
    h.results.push({ data: ROOF_ROW, error: null })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scheduled_at: SLOT })
    const update = h.queries.find((q) => q.ops.some((o) => o.op === 'update'))
    expect(update?.ops.find((o) => o.op === 'update')?.args[0]).toMatchObject({ scheduled_at: SLOT })
  })

  it('a customer-SMS failure does not skip the tradie alert', async () => {
    vi.mocked(dispatchQuoteMessage).mockRejectedValueOnce(new Error('twilio down'))
    h.results.push({ data: ROOF_ROW, error: null })
    h.results.push({ data: null, error: null })
    h.results.push({ data: TENANT, error: null })

    await post()
    expect(notifyRoofingTradie).toHaveBeenCalledTimes(1)
  })
})
