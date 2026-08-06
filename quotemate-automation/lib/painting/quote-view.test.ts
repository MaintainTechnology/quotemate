import { describe, expect, it } from 'vitest'
import { paintHeldForReview, paintQuotePayable, paintQuoteViewMode } from './quote-view'

describe('paintQuoteViewMode (spec painting-held-view-parity R1)', () => {
  it('renders the five-section view once prices are released', () => {
    expect(
      paintQuoteViewMode({ released: true, paid: false, inspection: false, fullParam: false }),
    ).toBe('five')
  })

  it('renders the five-section view once paid', () => {
    expect(
      paintQuoteViewMode({ released: false, paid: true, inspection: false, fullParam: false }),
    ).toBe('five')
  })

  it('renders the five-section view for an inspection-routed job', () => {
    expect(
      paintQuoteViewMode({ released: false, paid: false, inspection: true, fullParam: false }),
    ).toBe('five')
  })

  it('renders the five-section view for a HELD-for-review quote too', () => {
    // The defect this spec fixes: the held state used to take the long-scroll
    // branch, which has no TrustVideo — so the SMS link landed a customer on a
    // page with no tradie video until the painter pressed Send.
    expect(
      paintQuoteViewMode({ released: false, paid: false, inspection: false, fullParam: false }),
    ).toBe('five')
  })

  it('?full=1 forces the long-scroll layout in every state', () => {
    for (const state of [
      { released: true, paid: false, inspection: false },
      { released: false, paid: true, inspection: false },
      { released: false, paid: false, inspection: true },
      { released: false, paid: false, inspection: false },
    ]) {
      expect(paintQuoteViewMode({ ...state, fullParam: true })).toBe('long')
    }
  })
})

describe('paintHeldForReview (spec painting-held-view-parity R2)', () => {
  it('is true only for a priced, unreleased, unpaid, non-inspection row', () => {
    expect(paintHeldForReview({ released: false, paid: false, inspection: false })).toBe(true)
  })

  it('is false once the tradie releases, the visit is paid, or the job is inspection-routed', () => {
    expect(paintHeldForReview({ released: true, paid: false, inspection: false })).toBe(false)
    expect(paintHeldForReview({ released: false, paid: true, inspection: false })).toBe(false)
    expect(paintHeldForReview({ released: false, paid: false, inspection: true })).toBe(false)
    expect(paintHeldForReview({ released: true, paid: true, inspection: true })).toBe(false)
  })

  it('is the exact complement of the page’s payable gate', () => {
    // The money invariant: /q/paint/[token] renders the AcceptBlock and the
    // sticky pay bar on `showTiers || inspection || paid` (showTiers =
    // !inspection && prices released). Held must be true in EXACTLY the
    // states where that gate is false, so the held copy and a payment CTA can
    // never render on the same page.
    for (const released of [false, true]) {
      for (const paid of [false, true]) {
        for (const inspection of [false, true]) {
          // The REAL predicate the page consumes — not a hand-copy of its
          // expression, so an edit to the page's gate cannot silently drift
          // past this test (review 2026-08-06).
          const payable = paintQuotePayable({ released, paid, inspection })
          expect(paintHeldForReview({ released, paid, inspection })).toBe(!payable)
          // And it must still equal the page's historical formula.
          expect(payable).toBe((!inspection && released) || inspection || paid)
        }
      }
    }
  })
})
