// A post-site-visit child row must never be bookable (spec
// post-visit-money-sequence R11/R14).
//
// The chain's 'final' (deposit) and 'balance' rows are payments on a job whose
// site visit already happened. They satisfy this route's other guards — they
// are paid, and they have no scheduled_at — so without an explicit kind guard
// a customer who reached the URL could book a slot against one. That is not a
// cosmetic bug: this route stamps status='accepted' + booking_state='booked',
// PRUNES the chosen window out of the tenant's real availability, and fires
// the tradie's "booked and paid the deposit" SMS — inventing an appointment
// for a job that has no time attached and quietly costing the tradie a slot
// another customer could have taken.
//
// The /book PAGE redirects children before they get here; this is the
// API-level guard behind it, which is the one that matters for anyone holding
// the raw URL from the deposit-received SMS thread.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const results: Result[] = []
  const notify = vi.fn()

  function from() {
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'in', 'is', 'not', 'neq', 'maybeSingle', 'single']) {
      builder[op] = () => builder
    }
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, notify, client: { from } }
})

vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/quote/booking-notify', () => ({ notifyBookingConfirmed: h.notify }))

import { POST } from './route'

/** A future slot, so the request only fails on the guard under test. */
const SLOT = new Date(Date.now() + 7 * 86_400_000).toISOString()

function bookReq() {
  return new Request('https://app.test/api/q/tok/book', {
    method: 'POST',
    body: JSON.stringify({ slot: SLOT }),
  })
}

const ctx = { params: Promise.resolve({ token: 'tok-child' }) }

beforeEach(() => {
  h.results.length = 0
  h.notify.mockReset()
})

describe('POST /api/q/[token]/book — post-site-visit children', () => {
  for (const kind of ['final', 'balance'] as const) {
    it(`409s a paid '${kind}' row instead of booking a phantom visit`, async () => {
      h.results.push({
        data: {
          id: `q-${kind}`,
          paid_at: '2026-09-03T01:00:00Z',
          scheduled_at: null,
          selected_tier: 'good',
          share_token: 'tok-child',
          intake_id: 'i-1',
          tenant_id: 't-1',
          good: null,
          better: null,
          best: null,
          stripe_links: {},
          created_at: '2026-09-01T00:00:00Z',
          price_hold_until: null,
          needs_inspection: false,
          quote_kind: kind,
        },
        error: null,
      })

      const res = await POST(bookReq(), ctx)
      expect(res.status).toBe(409)
      const body = (await res.json()) as { ok: boolean; error: string }
      expect(body.ok).toBe(false)
      expect(body.error).toMatch(/no visit to book/i)

      // Nothing was written and nobody was told a booking happened.
      expect(h.notify).not.toHaveBeenCalled()
    })
  }

  it('still refuses an UNPAID row for the ordinary reason, not the kind guard', async () => {
    // Guards against the kind check being written so broadly it swallows the
    // pay-first rule that protects every initial quote.
    h.results.push({
      data: {
        id: 'q-init',
        paid_at: null,
        scheduled_at: null,
        selected_tier: 'better',
        share_token: 'tok-init',
        intake_id: 'i-1',
        tenant_id: 't-1',
        good: null,
        better: null,
        best: null,
        stripe_links: {},
        created_at: '2026-09-01T00:00:00Z',
        price_hold_until: null,
        needs_inspection: false,
        quote_kind: 'initial',
      },
      error: null,
    })

    const res = await POST(bookReq(), ctx)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/pay the deposit first/i)
  })
})
