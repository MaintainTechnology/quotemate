import { describe, expect, it } from 'vitest'
import { paintQuoteViewMode } from './quote-view'

describe('paintQuoteViewMode (spec painting-funnel-parity R1)', () => {
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

  it('keeps the long-scroll held view for a held-for-review quote', () => {
    // Priced but not released, not paid, not inspection-routed — the
    // publish-gate holding message must stay exactly as today.
    expect(
      paintQuoteViewMode({ released: false, paid: false, inspection: false, fullParam: false }),
    ).toBe('long')
  })

  it('?full=1 forces the long-scroll layout in every state', () => {
    expect(
      paintQuoteViewMode({ released: true, paid: false, inspection: false, fullParam: true }),
    ).toBe('long')
    expect(
      paintQuoteViewMode({ released: false, paid: true, inspection: false, fullParam: true }),
    ).toBe('long')
    expect(
      paintQuoteViewMode({ released: false, paid: false, inspection: true, fullParam: true }),
    ).toBe('long')
  })
})
