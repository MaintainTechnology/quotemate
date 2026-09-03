// A child payment settles the CHILD row and never touches its parent (spec
// post-visit-money-sequence R14).
//
// This is the property that lets one job carry three payments without a
// payments ledger. Every payment check is keyed on the row named by
// `metadata.quote_id` — the session-id dedupe, the "already paid, skip" guard,
// and finalisePaidQuote's conditional `WHERE paid_at IS NULL` claim — so a
// paid PARENT (which by definition has paid_at set from the $99 site visit)
// can neither block, nor be disturbed by, the deposit or balance that follows.
//
// Driven through the real POST handler with a stubbed Stripe + Supabase, so
// this fails on a behavioural regression rather than on a rename: if someone
// re-keys the lookup on intake_id, or on "the newest quote for this job", the
// balance silently stops recording and these assertions go red.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const CHILD = 'q-balance-child'
const PARENT = 'q-final-parent'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const deferred: Array<() => unknown> = []
  const advance = vi.fn()
  const notifyChild = vi.fn()
  const event: { value: unknown } = { value: null }

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'insert', 'eq', 'is', 'not', 'neq', 'limit', 'maybeSingle', 'single']) {
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

  return { results, queries, deferred, advance, notifyChild, event, client: { from } }
})

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.deferred.push(fn)
  },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEventAsync: async () => h.event.value },
  }),
}))
vi.mock('@/lib/quote/lifecycle', () => ({ advanceQuoteStatus: h.advance }))
vi.mock('@/lib/quote/booking-notify', () => ({
  notifyBookingConfirmed: vi.fn(),
  notifyChildPaymentReceived: h.notifyChild,
}))
vi.mock('@/lib/push/send', () => ({ sendPushToTenant: vi.fn() }))

import { POST } from './route'

/** A checkout.session.completed for the balance charge on a child row. */
function balanceEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_balance_1',
        amount_total: 280500,
        metadata: {
          quote_id: CHILD,
          tier: 'balance',
          purpose: 'balance',
          quote_kind: 'balance',
          parent_quote_id: PARENT,
          application_fee_cents: '5500',
          connect_destination: 'acct_jon',
          ...(overrides.metadata as Record<string, string> | undefined),
        },
        ...overrides,
      },
    },
  }
}

function webhookReq() {
  return new Request('https://app.test/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=stub' },
    body: '{}',
  })
}

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.deferred.length = 0
  h.advance.mockReset()
  h.notifyChild.mockReset()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_stub'
})

describe('POST /api/stripe/webhook — a balance session settles only its own row', () => {
  it('claims the CHILD with paid_at IS NULL and never queries the parent', async () => {
    h.event.value = balanceEvent()
    h.results.push(
      // 1. the webhook's row lookup by metadata.quote_id
      {
        data: {
          id: CHILD,
          paid_at: null,
          paid_stripe_session_id: null,
          scheduled_at: null,
          intake_id: 'i-1',
          tenant_id: 't-1',
          share_token: 'tok-balance',
          quote_kind: 'balance',
        },
        error: null,
      },
      // 2. finalisePaidQuote's conditional claim
      { data: [{ id: CHILD }], error: null },
      // 3. the fund-flow stamp
      { data: null, error: null },
    )

    const res = await POST(webhookReq())
    expect(res.status).toBe(200)

    // Every query targeted the child, by id. The parent is never named.
    const allArgs = JSON.stringify(h.queries.map((q) => q.ops))
    expect(allArgs).toContain(CHILD)
    expect(allArgs).not.toContain(PARENT)
    // …and nothing reached for a sibling by intake, which would pick the wrong row.
    expect(h.queries.some((q) => q.ops.some((o) => o.op === 'eq' && o.args[0] === 'intake_id'))).toBe(
      false,
    )

    // The claim is conditional — this is what makes a re-delivered event safe.
    const claim = h.queries[1]
    expect(claim.table).toBe('quotes')
    expect(claim.ops).toContainEqual({ op: 'is', args: ['paid_at', null] })
    expect(claim.ops).toContainEqual({ op: 'eq', args: ['id', CHILD] })
    const patch = claim.ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>
    expect(patch).toMatchObject({ paid_tier: 'balance', paid_stripe_session_id: 'cs_balance_1' })

    // A balance payment settles the job; it does not book anything.
    expect(h.advance).toHaveBeenCalledWith(expect.anything(), CHILD, 'paid')
    const wroteBookingState = h.queries.some((q) =>
      q.ops.some(
        (o) => o.op === 'update' && 'booking_state' in (o.args[0] as Record<string, unknown>),
      ),
    )
    expect(wroteBookingState).toBe(false)

    await h.deferred[0]()
    expect(h.notifyChild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quoteId: CHILD, kind: 'balance', chargedCents: 280500 }),
    )
  })

  it('records the fee from metadata so the payout nets the tradie exactly the base', async () => {
    h.event.value = balanceEvent()
    h.results.push(
      {
        data: {
          id: CHILD,
          paid_at: null,
          paid_stripe_session_id: null,
          scheduled_at: null,
          intake_id: 'i-1',
          tenant_id: 't-1',
          share_token: 'tok-balance',
          quote_kind: 'balance',
        },
        error: null,
      },
      { data: [{ id: CHILD }], error: null },
      { data: null, error: null },
    )

    await POST(webhookReq())

    const stamp = h.queries[2].ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>
    // 280500 charged − 5500 fee = 275000 base, the balance the customer was quoted.
    expect(stamp.paid_amount_cents).toBe(280500)
    expect(stamp.platform_fee_cents).toBe(5500)
    expect(stamp.stripe_connect_destination).toBe('acct_jon')
    expect(
      (stamp.paid_amount_cents as number) - (stamp.platform_fee_cents as number),
    ).toBe(275000)
  })

  it('leaves an already-paid row alone — a re-delivered event is a no-op', async () => {
    h.event.value = balanceEvent()
    h.results.push({
      data: {
        id: CHILD,
        paid_at: '2026-09-03T02:00:00Z',
        paid_stripe_session_id: 'cs_other',
        scheduled_at: null,
        intake_id: 'i-1',
        tenant_id: 't-1',
        share_token: 'tok-balance',
        quote_kind: 'balance',
      },
      error: null,
    })

    const res = await POST(webhookReq())
    expect(res.status).toBe(200)
    // Lookup only — no claim, no stamp, no notification.
    expect(h.queries).toHaveLength(1)
    expect(h.advance).not.toHaveBeenCalled()
    expect(h.deferred).toHaveLength(0)
  })

  it('drops a session that names no tier rather than guessing one', async () => {
    // A child session minted without metadata.tier must be ACKed and ignored,
    // never applied to whichever row looks closest.
    h.event.value = balanceEvent({ metadata: { tier: '' } })
    const res = await POST(webhookReq())
    expect(res.status).toBe(200)
    expect(h.queries).toHaveLength(0)
  })
})
