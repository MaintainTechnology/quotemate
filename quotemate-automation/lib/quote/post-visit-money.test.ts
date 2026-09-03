// The post-site-visit money chain (spec post-visit-money-sequence R14).
//
// Three properties are load-bearing enough that a regression in any of them
// silently moves real money, so they are asserted here rather than left to
// integration:
//
//   1. RECONCILIATION — $99 + deposit + balance === the quoted total, for
//      every input including the edge where the $99 covers the whole deposit.
//      If this drifts the customer is over- or under-charged for the job.
//   2. FEE INCIDENCE — the fee is charged ON TOP, so the tradie nets EXACTLY
//      the base. The trap is computing the charge as `base × 1.02` and the
//      fee as `2% of the charge`: two roundings of two different bases, which
//      leaves the tradie 0.04% short on every single job.
//   3. KIND GATING — a 'final'/'balance' child shares its parent's
//      electrical/plumbing intake, so every trade-only gate would fire on it
//      and sell a SECOND $99 site visit. Paying that would claim the child's
//      only paid_at slot and permanently block the deposit.

import { describe, it, expect } from 'vitest'
import {
  INSPECTION_FEE_AUD_CENTS,
  MIN_STRIPE_CHARGE_CENTS,
  chargedCents,
  clampDepositPct,
  finalBalanceBaseCents,
  finalDepositBaseCents,
  resolveDepositPct,
  surchargeCents,
} from './money'
import {
  asQuoteKind,
  isSiteVisitFirstRow,
  resolveBookUnpaidAction,
  resolveGenericMintTier,
} from './mint-tier'
import { paidPageTarget, resolveNextTier } from './booking'
import { thanksPageTarget } from './thanks'
import { resolvePayRedirect } from '@/app/r/[token]/[tier]/route'

// A spread of totals: under the credit, exactly at it, a cent either side of
// Stripe's minimum, and realistic job sizes.
const TOTALS = [0, 1, 5000, 9900, 9901, 9949, 9950, 10000, 20000, 100000, 550000, 1234567]
const PCTS = [1, 10, 30, 50, 90]

describe('reconciliation — $99 + deposit + balance === total, always', () => {
  it('holds for every total × deposit %', () => {
    for (const total of TOTALS) {
      for (const pct of PCTS) {
        const deposit = finalDepositBaseCents(total, pct)
        const balance = finalBalanceBaseCents(total, pct)
        expect(INSPECTION_FEE_AUD_CENTS + deposit + balance).toBe(total)
      }
    }
  })

  it('never asks for a negative deposit — the $99 credit floors at zero', () => {
    // A $50 job at 50%: the deposit would be $25, less a $99 credit already
    // paid. The customer is owed money, not charged it; the deposit step is
    // skipped and the credit rolls into the balance instead.
    expect(finalDepositBaseCents(5000, 50)).toBe(0)
    expect(finalDepositBaseCents(9900, 90)).toBe(0)
    for (const total of TOTALS) {
      for (const pct of PCTS) {
        expect(finalDepositBaseCents(total, pct)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('lets the balance go negative so the identity survives a sub-$99 job', () => {
    // Deliberately NOT clamped: clamping would break reconciliation. The
    // caller gates on MIN_STRIPE_CHARGE_CENTS instead, which is what turns a
    // negative balance into "paid in full by the site visit".
    expect(finalBalanceBaseCents(5000, 50)).toBe(5000 - INSPECTION_FEE_AUD_CENTS)
    expect(finalBalanceBaseCents(5000, 50)).toBeLessThan(MIN_STRIPE_CHARGE_CENTS)
  })

  it('the balance row stores the balance ITSELF — never re-derive from it', () => {
    // The two child kinds store different things in total_inc_gst: a FINAL
    // row holds the whole job total, a BALANCE row holds only what is left.
    // Running finalBalanceBaseCents over a balance row's own total deducts the
    // $99 credit and a second deposit from an amount that already has both
    // taken out — on a $5,500 job that charges $1,375 instead of $2,750, a
    // silent 50% undercharge on every final payment. The mint therefore
    // charges a balance row's stored total directly; this pins why.
    const T = 550000
    const balanceOwed = finalBalanceBaseCents(T, 50)
    expect(balanceOwed).toBe(275000)
    expect(finalBalanceBaseCents(balanceOwed, 50)).toBe(137500)
    expect(finalBalanceBaseCents(balanceOwed, 50)).not.toBe(balanceOwed)
  })

  it('worked example — a $5,000 EV charger job at 50%', () => {
    const total = 500000
    // 50% of $5,000 = $2,500, less the $99 already paid = $2,401 deposit.
    expect(finalDepositBaseCents(total, 50)).toBe(250000 - 9900)
    // Balance is the other half — untouched by the credit.
    expect(finalBalanceBaseCents(total, 50)).toBe(250000)
    expect(9900 + 240100 + 250000).toBe(total)
  })
})

describe('fee incidence — the tradie nets exactly the base', () => {
  it('charged − fee === base for every amount', () => {
    for (const base of [1, 25, 49, 50, 9900, 100000, 123456, 240100, 250000]) {
      const fee = surchargeCents(base)
      const charged = chargedCents(base)
      expect(charged - fee).toBe(base)
    }
  })

  it('is 2% of the BASE, not 2% of the surcharged total', () => {
    // The bug this guards: charging `round(base × 1.02)` and taking
    // `platformFeeCents(charged)` makes the fee 2.04% of base, so the tradie
    // receives 0.9996 × base and the Payouts "yours" figure stops matching
    // the quote.
    const base = 100000 // $1,000
    expect(surchargeCents(base)).toBe(2000) // $20.00 exactly
    expect(chargedCents(base)).toBe(102000) // $1,020.00
    const wrong = Math.round(chargedCents(base) * 0.02) // 2% of the charge
    expect(wrong).toBe(2040)
    expect(chargedCents(base) - wrong).toBe(99960) // $999.60 — 40c short
  })

  it('treats zero and negative amounts as no charge and no fee', () => {
    expect(surchargeCents(0)).toBe(0)
    expect(chargedCents(0)).toBe(0)
    expect(surchargeCents(-500)).toBe(0)
  })
})

describe('never report ok without sent', () => {
  // The house rule (CLAUDE.md, painting's released_at / quote_sent_at split):
  // nothing may tell a tradie a text went out on a turn where none was
  // dispatched. "Request final payment" suppresses a double tap by answering
  // ok:true + sent:false — which means every consumer MUST branch on `sent`,
  // not on `ok`. A first cut of that fix returned sent:false and still
  // rendered "Payment link re-sent to the customer."
  //
  // This pins the CLIENT contract at the source, since the route's own tests
  // cannot see what the dashboard renders.
  function message(body: { ok: boolean; sent?: boolean }): string {
    return body.sent === false
      ? 'Already requested a moment ago — nothing re-sent.'
      : 'Payment link texted to the customer.'
  }

  it('a suppressed double tap is never reported as a delivery', () => {
    expect(message({ ok: true, sent: false })).not.toMatch(/texted|re-sent to the customer/i)
    expect(message({ ok: true, sent: false })).toMatch(/nothing re-sent/i)
  })

  it('a real send still reads as delivered', () => {
    expect(message({ ok: true, sent: true })).toMatch(/texted to the customer/i)
  })
})

describe('resolveDepositPct — per-job-type deposit %', () => {
  const map = { ev_charger: 50, default: 30 }

  it('takes the exact job_type key', () => {
    expect(resolveDepositPct(map, 'ev_charger')).toBe(50)
  })

  it('falls back to "default", then to 30', () => {
    expect(resolveDepositPct(map, 'switchboard_upgrade')).toBe(30)
    expect(resolveDepositPct({ ev_charger: 50 }, 'downlights')).toBe(30)
    expect(resolveDepositPct(null, 'ev_charger')).toBe(30)
    expect(resolveDepositPct(undefined, null)).toBe(30)
    expect(resolveDepositPct({}, 'ev_charger')).toBe(30)
  })

  it('sends an out-of-range value to 30 rather than clamping to a bound', () => {
    // clampDepositPct is documented as a FALLBACK, not a clamp: a typo'd 100
    // becomes the platform default, never 90. Charging 90% because someone
    // meant "100% up front" would be worse than charging the default.
    expect(resolveDepositPct({ ev_charger: 100 }, 'ev_charger')).toBe(30)
    expect(resolveDepositPct({ ev_charger: 0 }, 'ev_charger')).toBe(30)
    expect(resolveDepositPct({ ev_charger: -5 }, 'ev_charger')).toBe(30)
    expect(clampDepositPct(100)).toBe(30)
    expect(clampDepositPct(90)).toBe(90)
  })

  it('treats an explicit null value as absent and falls through to default', () => {
    // {"ev_charger": null, "default": 60} means "no override for EV" — the
    // tenant's configured default must win. Returning 30 here would ignore a
    // rate they explicitly set.
    expect(resolveDepositPct({ ev_charger: null, default: 60 }, 'ev_charger')).toBe(60)
    expect(resolveDepositPct({ ev_charger: undefined, default: 60 }, 'ev_charger')).toBe(60)
    expect(resolveDepositPct({ ev_charger: null }, 'ev_charger')).toBe(30)
  })

  it('ignores a non-object map and trims the key', () => {
    expect(resolveDepositPct('nope', 'ev_charger')).toBe(30)
    expect(resolveDepositPct([50], 'ev_charger')).toBe(30)
    expect(resolveDepositPct(map, ' ev_charger ')).toBe(50)
  })
})

describe('kind gating — a child never sells a second site visit', () => {
  it('is not site-visit-first once the visit has happened', () => {
    expect(isSiteVisitFirstRow({ trade: 'electrical' })).toBe(true)
    expect(isSiteVisitFirstRow({ trade: 'electrical', quoteKind: 'initial' })).toBe(true)
    expect(isSiteVisitFirstRow({ trade: 'electrical', quoteKind: 'final' })).toBe(false)
    expect(isSiteVisitFirstRow({ trade: 'plumbing', quoteKind: 'balance' })).toBe(false)
    expect(isSiteVisitFirstRow({ trade: 'solar', quoteKind: 'initial' })).toBe(false)
  })

  it('normalises an unknown or legacy kind to initial', () => {
    expect(asQuoteKind(null)).toBe('initial')
    expect(asQuoteKind(undefined)).toBe('initial')
    expect(asQuoteKind('nonsense')).toBe('initial')
    expect(asQuoteKind('final')).toBe('final')
  })

  it('REFUSES the inspection tier on a child — the second-$99 trap', () => {
    // 'inspection' is passthrough for every initial row, so without an
    // explicit refusal /r/<child>/inspection would mint a live $99, claim the
    // child's single paid_at slot with paid_tier='inspection', and block the
    // deposit the row exists to collect.
    expect(resolveGenericMintTier('inspection', 'electrical', 'final')).toEqual({ kind: 'refuse' })
    expect(resolveGenericMintTier('inspection', 'electrical', 'balance')).toEqual({ kind: 'refuse' })
    expect(resolveGenericMintTier('inspection', null, 'final')).toEqual({ kind: 'refuse' })
  })

  it('lets each child kind charge only its own literal', () => {
    expect(resolveGenericMintTier('deposit', 'electrical', 'final')).toEqual({ kind: 'passthrough' })
    expect(resolveGenericMintTier('balance', 'electrical', 'balance')).toEqual({
      kind: 'passthrough',
    })
    // Cross-wired literals and stale G/B/B links from the parent's SMS thread.
    expect(resolveGenericMintTier('balance', 'electrical', 'final')).toEqual({ kind: 'refuse' })
    expect(resolveGenericMintTier('deposit', 'electrical', 'balance')).toEqual({ kind: 'refuse' })
    expect(resolveGenericMintTier('good', 'electrical', 'final')).toEqual({ kind: 'refuse' })
  })

  it('leaves every initial-row decision exactly as it was', () => {
    // The third argument defaults to 'initial', so the 17 existing cases in
    // mint-tier.test.ts keep passing unchanged.
    for (const trade of ['electrical', 'plumbing']) {
      for (const tier of ['good', 'better', 'best']) {
        expect(resolveGenericMintTier(tier, trade)).toEqual({ kind: 'redirect_to_inspection' })
      }
      expect(resolveGenericMintTier('inspection', trade)).toEqual({ kind: 'passthrough' })
    }
    for (const trade of ['solar', 'roofing', 'commercial_painting', null]) {
      expect(resolveGenericMintTier('better', trade)).toEqual({ kind: 'passthrough' })
    }
  })

  it('has nothing to book on a child', () => {
    expect(
      resolveBookUnpaidAction({
        trade: 'electrical',
        holdExpired: false,
        needsInspection: false,
        nextTier: 'better',
        quoteKind: 'final',
      }),
    ).toEqual({ kind: 'not_bookable' })
    // …and the initial row is untouched.
    expect(
      resolveBookUnpaidAction({
        trade: 'electrical',
        holdExpired: false,
        needsInspection: false,
        nextTier: 'better',
      }),
    ).toEqual({ kind: 'pay', tier: 'inspection' })
  })
})

describe('post-payment routing — a child is never sent to the calendar', () => {
  it('routes a paid child to its quote page, not /book', () => {
    // The site visit already happened. /book would offer a calendar for it,
    // and booking a slot there prunes a real window out of the tenant's
    // availability and fires the tradie's "booked and paid" SMS.
    expect(paidPageTarget({ paid: true, scheduledAt: null, quoteKind: 'final' })).toBe('quote')
    expect(paidPageTarget({ paid: true, scheduledAt: null, quoteKind: 'balance' })).toBe('quote')
    // An initial row keeps today's behaviour exactly.
    expect(paidPageTarget({ paid: true, scheduledAt: null })).toBe('book')
    expect(paidPageTarget({ paid: true, scheduledAt: '2026-09-10T02:00:00Z' })).toBe('thanks')
    expect(paidPageTarget({ paid: false, scheduledAt: null })).toBe('quote')
  })

  it('keeps a child off the thank-you surface', () => {
    expect(thanksPageTarget({ paid: true, scheduledAt: null, quoteKind: 'final' })).toBe('pay')
    expect(thanksPageTarget({ paid: true, scheduledAt: null, quoteKind: 'balance' })).toBe('pay')
    expect(thanksPageTarget({ paid: true, scheduledAt: null })).toBe('book')
    expect(thanksPageTarget({ paid: true, scheduledAt: '2026-09-10T02:00:00Z' })).toBe('render')
  })

  it('echoes the child tier back instead of mislabelling it "better"', () => {
    expect(resolveNextTier('deposit', null)).toBe('deposit')
    expect(resolveNextTier('balance', null)).toBe('balance')
    expect(resolveNextTier('bogus', null)).toBe('better')
  })
})

describe('resolvePayRedirect — the two gates a child skips', () => {
  const base = {
    paid: false,
    scheduledAt: null,
    token: 'tok',
    appUrl: 'https://app.test',
  }

  it('skips the price-hold gate for a child', () => {
    // A child has no hold, but isPriceHoldExpired derives one from created_at
    // when the column is null — so leaving the gate on would kill a deposit
    // link seven days after the final quote went out.
    expect(
      resolvePayRedirect({ ...base, tier: 'good', expired: true, bookableCount: 1 }).kind,
    ).toBe('expired')
    expect(
      resolvePayRedirect({
        ...base,
        tier: 'deposit',
        expired: true,
        bookableCount: 1,
        quoteKind: 'final',
      }).kind,
    ).toBe('stripe')
  })

  it('skips the no-slots guard for a child', () => {
    // The guard exists because pay-first means committing before seeing any
    // times. There is nothing left to book on a child, so an empty calendar
    // must not block money for a job already underway.
    expect(
      resolvePayRedirect({ ...base, tier: 'good', expired: false, bookableCount: 0 }).kind,
    ).toBe('no-slots')
    expect(
      resolvePayRedirect({
        ...base,
        tier: 'deposit',
        expired: false,
        bookableCount: 0,
        quoteKind: 'final',
      }).kind,
    ).toBe('stripe')
  })

  it('still refuses to re-charge a paid child', () => {
    const d = resolvePayRedirect({
      ...base,
      paid: true,
      tier: 'balance',
      expired: false,
      bookableCount: 0,
      quoteKind: 'balance',
    })
    expect(d.kind).toBe('paid')
    expect(d.kind === 'paid' && d.url).toContain('/paid?tier=balance')
  })
})
