// WP6 regression coverage — price-hold / urgency + booking-state model.
//
// Locks in the behaviour the brief demands: a quote shows a real
// "held until" window, the window expires deterministically, and a
// paid deposit moves the quote into an explicit reserved/booked state
// without ever downgrading a job that is already booked.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOLD_DAYS,
  BOOKING_STATE,
  computePriceHoldUntil,
  priceHoldStatus,
  resolvePriceHoldUntil,
  isPriceHoldExpired,
  fmtHoldUntilAU,
  bookingStateAfterDepositPaid,
  bookingStateAfterSlotPicked,
  bookingStateLabel,
} from './hold'

const DAY = 24 * 60 * 60 * 1000
const CREATED = '2026-05-18T00:00:00.000Z'

describe('computePriceHoldUntil', () => {
  it('defaults to created_at + DEFAULT_HOLD_DAYS', () => {
    const out = computePriceHoldUntil(CREATED)
    expect(out).toBe(new Date(Date.parse(CREATED) + DEFAULT_HOLD_DAYS * DAY).toISOString())
  })
  it('honours a custom day count', () => {
    const out = computePriceHoldUntil(CREATED, 3)
    expect(out).toBe(new Date(Date.parse(CREATED) + 3 * DAY).toISOString())
  })
  it('returns null for missing input', () => {
    expect(computePriceHoldUntil(null)).toBeNull()
    expect(computePriceHoldUntil(undefined)).toBeNull()
  })
  it('returns null for an unparseable date', () => {
    expect(computePriceHoldUntil('not-a-date')).toBeNull()
  })
})

describe('priceHoldStatus', () => {
  it("state 'none' when no hold is set", () => {
    const s = priceHoldStatus(null)
    expect(s.state).toBe('none')
    expect(s.holdUntil).toBeNull()
    expect(s.daysRemaining).toBe(0)
  })
  it("state 'none' for an unparseable hold value", () => {
    expect(priceHoldStatus('garbage').state).toBe('none')
  })
  it("state 'held' with correct daysRemaining when in the future", () => {
    const now = Date.parse(CREATED)
    const until = new Date(now + 3 * DAY + 5000).toISOString()
    const s = priceHoldStatus(until, now)
    expect(s.state).toBe('held')
    expect(s.daysRemaining).toBe(3)
    expect(s.msRemaining).toBeGreaterThan(0)
    expect(s.holdUntil).toBe(until)
  })
  it("state 'expired' once the hold has passed", () => {
    const now = Date.parse(CREATED)
    const until = new Date(now - 1000).toISOString()
    const s = priceHoldStatus(until, now)
    expect(s.state).toBe('expired')
    expect(s.daysRemaining).toBe(0)
    expect(s.msRemaining).toBeLessThan(0)
  })
  it("treats the exact expiry instant as 'expired' (boundary)", () => {
    const now = Date.parse(CREATED)
    expect(priceHoldStatus(new Date(now).toISOString(), now).state).toBe('expired')
  })
})

describe('resolvePriceHoldUntil', () => {
  it('prefers the persisted price_hold_until over the derived date', () => {
    const persisted = '2026-06-01T00:00:00.000Z'
    expect(resolvePriceHoldUntil(persisted, CREATED)).toBe(persisted)
  })
  it('derives from created_at (+ default days) when not persisted', () => {
    expect(resolvePriceHoldUntil(null, CREATED)).toBe(
      new Date(Date.parse(CREATED) + DEFAULT_HOLD_DAYS * DAY).toISOString(),
    )
    expect(resolvePriceHoldUntil(undefined, CREATED)).toBe(
      new Date(Date.parse(CREATED) + DEFAULT_HOLD_DAYS * DAY).toISOString(),
    )
  })
  it('returns null when neither input yields a date', () => {
    expect(resolvePriceHoldUntil(null, null)).toBeNull()
    expect(resolvePriceHoldUntil(undefined, undefined)).toBeNull()
  })
})

describe('isPriceHoldExpired', () => {
  const now = Date.parse(CREATED)
  it('false while the persisted hold is still in the future', () => {
    const until = new Date(now + 2 * DAY).toISOString()
    expect(isPriceHoldExpired(until, null, now)).toBe(false)
  })
  it('true once the persisted hold has lapsed', () => {
    const until = new Date(now - 1000).toISOString()
    expect(isPriceHoldExpired(until, null, now)).toBe(true)
  })
  it('derives from created_at when no persisted hold — not expired within the window', () => {
    // created_at + 7 days; check 3 days in
    expect(isPriceHoldExpired(null, CREATED, now + 3 * DAY)).toBe(false)
  })
  it('derives from created_at when no persisted hold — expired past the window', () => {
    // 8 days after created_at is beyond the default 7-day hold
    expect(isPriceHoldExpired(null, CREATED, now + 8 * DAY)).toBe(true)
  })
  it('a quote with no derivable hold is NOT expired', () => {
    expect(isPriceHoldExpired(null, null, now)).toBe(false)
  })
})

describe('fmtHoldUntilAU', () => {
  it('produces an ASCII-only short AU label', () => {
    const label = fmtHoldUntilAU('2026-05-22T03:00:00.000Z')
    expect(label.length).toBeGreaterThan(0)
    expect(/^[\x20-\x7E]+$/.test(label)).toBe(true)
    expect(label).toMatch(/May/)
  })
  it('returns empty string for missing/invalid input', () => {
    expect(fmtHoldUntilAU(null)).toBe('')
    expect(fmtHoldUntilAU('nope')).toBe('')
  })
})

describe('booking-state transitions', () => {
  it('deposit paid on a fresh quote -> reserved', () => {
    expect(bookingStateAfterDepositPaid(null)).toBe(BOOKING_STATE.RESERVED)
    expect(bookingStateAfterDepositPaid(undefined)).toBe('reserved')
  })
  it('deposit paid is idempotent on an already-reserved quote', () => {
    expect(bookingStateAfterDepositPaid('reserved')).toBe(BOOKING_STATE.RESERVED)
  })
  it('deposit paid NEVER downgrades an already-booked quote', () => {
    expect(bookingStateAfterDepositPaid('booked')).toBe(BOOKING_STATE.BOOKED)
  })
  it('slot picked -> booked (terminal)', () => {
    expect(bookingStateAfterSlotPicked()).toBe(BOOKING_STATE.BOOKED)
  })
  it('labels map to customer-facing words', () => {
    expect(bookingStateLabel(null)).toBe('Draft')
    expect(bookingStateLabel('reserved')).toBe('Reserved')
    expect(bookingStateLabel('booked')).toBe('Booked')
  })
})
