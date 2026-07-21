// RC-6 — once a roofing measurement is promoted to a real `quotes` row
// (save-as-quote stamps roofing_measurements.quote_share_token), that quote is
// the single source of truth: its good/better/best tiers are what the tradie
// edits and what /q/[token] renders. The customer PAGE already redirects
// (app/q/roof/[token]/page.tsx), but the PDF route did not — so the SMS'd
// /api/q/roof/[token]/pdf link kept serving a SECOND, native document that
// ignores every later edit. This rule is now shared by both surfaces so they
// cannot drift apart again.

import { describe, it, expect } from 'vitest'
import { servesPromotedQuote } from './promotion'

describe('servesPromotedQuote (RC-6 — one document per job)', () => {
  it('an un-promoted measurement serves its own native roofing document', () => {
    expect(servesPromotedQuote({ quote_share_token: null, paid_at: null }, false)).toBe(false)
  })

  it('a promoted measurement defers to the promoted quote (so edits are reflected)', () => {
    expect(servesPromotedQuote({ quote_share_token: 'tok123', paid_at: null }, false)).toBe(true)
  })

  it('a measurement that already took its own site-visit payment keeps its receipt document', () => {
    // Mirrors the page guard: a paid measurement IS that payment's receipt.
    expect(
      servesPromotedQuote({ quote_share_token: 'tok123', paid_at: '2026-07-01T00:00:00Z' }, false),
    ).toBe(false)
  })

  it('?full=1 (the dashboard rich measurement view) keeps the native document', () => {
    expect(servesPromotedQuote({ quote_share_token: 'tok123', paid_at: null }, true)).toBe(false)
  })
})
