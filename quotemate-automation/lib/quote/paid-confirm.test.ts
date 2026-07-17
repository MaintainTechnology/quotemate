// finalisePaidQuote — the ONE claim+finalise path shared by the Stripe
// webhook and the /q/[token]/paid page's session-verification fallback.
//
// The conditional claim (`… WHERE paid_at IS NULL`) is the idempotency
// guard: whichever caller lands first performs the full finalise (booking
// state, slot prune, confirmation SMS, status advance); the loser matches
// zero rows and must perform NO side effects. Losing the SMS/prune when the
// /paid page wins the race is exactly the bug this module prevents.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const deferred: Array<() => unknown> = []
  const notify = vi.fn()
  const advance = vi.fn()

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'not', 'is', 'maybeSingle']) {
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

  return { results, queries, deferred, notify, advance, client: { from } }
})

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.deferred.push(fn)
  },
}))
vi.mock('@/lib/quote/booking-notify', () => ({ notifyBookingConfirmed: h.notify }))
vi.mock('@/lib/quote/lifecycle', () => ({ advanceQuoteStatus: h.advance }))

import { confirmPaidFromSession, finalisePaidQuote, sessionConfirmsQuote } from './paid-confirm'

const quote = {
  id: 'q-1',
  scheduled_at: null as string | null,
  intake_id: 'i-1',
  tenant_id: 't-1',
  share_token: 'tok-1',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = h.client as any

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.deferred.length = 0
  h.notify.mockReset()
  h.advance.mockReset()
})

describe('finalisePaidQuote', () => {
  it('claims conditionally (paid_at IS NULL) and finalises a slot-held quote as booked + accepted', async () => {
    h.results.push(
      { data: [{ id: 'q-1' }], error: null }, // claim matched
      { data: null, error: null }, // fund-flow stamp
      { data: null, error: null }, // booking finalise patch
      { data: { id: 't-1', available_slots: ['2026-07-10T02:00:00Z'] }, error: null }, // tenant slots
      { data: null, error: null }, // slot prune update
    )
    const out = await finalisePaidQuote(sb, {
      quote: { ...quote, scheduled_at: '2026-07-10T02:00:00Z' },
      tier: 'good',
      sessionId: 'cs_1',
    })
    expect(out).toEqual({ claimed: true })

    const claim = h.queries[0]
    expect(claim.table).toBe('quotes')
    expect(claim.ops).toContainEqual({ op: 'is', args: ['paid_at', null] })
    expect(claim.ops).toContainEqual({ op: 'eq', args: ['id', 'q-1'] })
    const claimUpdate = claim.ops.find((o) => o.op === 'update')!
    expect(claimUpdate.args[0]).toMatchObject({ paid_tier: 'good', paid_stripe_session_id: 'cs_1' })

    // Slot held → booked + accepted.
    const finalise = h.queries[2]
    const patch = finalise.ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>
    expect(patch.booking_state).toBe('booked')
    expect(patch.status).toBe('accepted')

    // Slot pruned from the tenant list.
    const prune = h.queries[4]
    expect(prune.table).toBe('tenants')
    expect(prune.ops.find((o) => o.op === 'update')!.args[0]).toEqual({ available_slots: [] })

    // Confirmation SMS deferred with the slot.
    expect(h.deferred).toHaveLength(1)
    h.deferred[0]()
    expect(h.notify).toHaveBeenCalledWith(sb, expect.objectContaining({ quoteId: 'q-1', slotIso: '2026-07-10T02:00:00Z' }))
    expect(h.advance).toHaveBeenCalledWith(sb, 'q-1', 'paid')
  })

  it('paid with NO slot → reserved, no status change, nudge SMS with slotIso null', async () => {
    h.results.push(
      { data: [{ id: 'q-1' }], error: null }, // claim matched
      { data: null, error: null }, // fund-flow stamp
      { data: null, error: null }, // booking finalise patch
    )
    const out = await finalisePaidQuote(sb, { quote, tier: 'inspection', sessionId: 'cs_2' })
    expect(out).toEqual({ claimed: true })

    const patch = h.queries[2].ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>
    expect(patch.booking_state).toBe('reserved')
    expect(patch.status).toBeUndefined()

    expect(h.deferred).toHaveLength(1)
    h.deferred[0]()
    expect(h.notify).toHaveBeenCalledWith(sb, expect.objectContaining({ quoteId: 'q-1', slotIso: null }))
  })

  it('lost the claim race (0 rows) → claimed:false and NO side effects', async () => {
    h.results.push({ data: [], error: null }) // claim matched nothing
    const out = await finalisePaidQuote(sb, { quote, tier: 'good', sessionId: 'cs_3' })
    expect(out).toEqual({ claimed: false })
    expect(h.queries).toHaveLength(1) // only the claim ran
    expect(h.deferred).toHaveLength(0)
    expect(h.advance).not.toHaveBeenCalled()
  })

  it('claim DB error → claimed:false with the error surfaced (webhook 500s so Stripe retries)', async () => {
    h.results.push({ data: null, error: { message: 'boom' } })
    const out = await finalisePaidQuote(sb, { quote, tier: 'good', sessionId: 'cs_4' })
    expect(out).toEqual({ claimed: false, error: 'boom' })
    expect(h.deferred).toHaveLength(0)
  })
})

describe('confirmPaidFromSession — the /paid page webhook-race guard', () => {
  it('a paid session for THIS quote → finalises (claim + booking) and reports paid', async () => {
    h.results.push(
      { data: [{ id: 'q-1' }], error: null }, // claim matched
      { data: null, error: null }, // fund-flow stamp
      { data: null, error: null }, // booking finalise patch
    )
    const retrieve = vi.fn().mockResolvedValue({
      id: 'cs_guard',
      payment_status: 'paid',
      amount_total: 9900,
      metadata: { quote_id: 'q-1', tier: 'inspection' },
    })
    const out = await confirmPaidFromSession(sb, retrieve, {
      quote,
      sessionId: 'cs_guard',
    })
    expect(out).toEqual({ paid: true, tier: 'inspection' })
    expect(retrieve).toHaveBeenCalledWith('cs_guard')
    // The claim ran with the session id — same finalise the webhook runs.
    const claimUpdate = h.queries[0].ops.find((o) => o.op === 'update')!
    expect(claimUpdate.args[0]).toMatchObject({
      paid_tier: 'inspection',
      paid_stripe_session_id: 'cs_guard',
    })
  })

  it("a session that doesn't pay this quote → no finalise, reports unpaid", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: 'cs_other',
      payment_status: 'paid',
      metadata: { quote_id: 'q-OTHER', tier: 'good' },
    })
    const out = await confirmPaidFromSession(sb, retrieve, { quote, sessionId: 'cs_other' })
    expect(out).toEqual({ paid: false, tier: null })
    expect(h.queries).toHaveLength(0) // nothing written
  })

  it('Stripe unreachable → never throws; renders from DB state (webhook stays authoritative)', async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error('stripe down'))
    const out = await confirmPaidFromSession(sb, retrieve, { quote, sessionId: 'cs_down' })
    expect(out).toEqual({ paid: false, tier: null })
    expect(h.queries).toHaveLength(0)
  })

  it('lost the claim race to the webhook → still reports paid (the quote IS paid)', async () => {
    h.results.push({ data: [], error: null }) // claim matched nothing
    const retrieve = vi.fn().mockResolvedValue({
      id: 'cs_race',
      payment_status: 'paid',
      metadata: { quote_id: 'q-1', tier: 'better' },
    })
    const out = await confirmPaidFromSession(sb, retrieve, { quote, sessionId: 'cs_race' })
    expect(out).toEqual({ paid: true, tier: 'better' })
  })
})

describe('sessionConfirmsQuote — /paid page session_id verification', () => {
  it('accepts a paid session whose metadata targets this quote', () => {
    expect(
      sessionConfirmsQuote(
        { payment_status: 'paid', metadata: { quote_id: 'q-1', tier: 'inspection' } },
        'q-1',
      ),
    ).toEqual({ tier: 'inspection' })
  })

  it('rejects unpaid, mismatched, or metadata-less sessions', () => {
    expect(
      sessionConfirmsQuote({ payment_status: 'unpaid', metadata: { quote_id: 'q-1', tier: 'good' } }, 'q-1'),
    ).toBeNull()
    expect(
      sessionConfirmsQuote({ payment_status: 'paid', metadata: { quote_id: 'q-OTHER', tier: 'good' } }, 'q-1'),
    ).toBeNull()
    expect(sessionConfirmsQuote({ payment_status: 'paid', metadata: null }, 'q-1')).toBeNull()
  })
})
