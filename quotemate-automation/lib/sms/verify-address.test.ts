// ════════════════════════════════════════════════════════════════════
// verify-address — the SMS receptionists' pre-read-back map check.
//
// The anchor scenario is live 2026-07-23: "15 Schofield drive safety
// each" ("each" for "beach") was read straight back and confirmed. The
// check must turn that into a corrected suggestion, reject addresses the
// map can't find at all (bounded), and change NOTHING when the API is
// unavailable.
// ════════════════════════════════════════════════════════════════════

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type AddressSlotsLike,
  MAX_ADDRESS_VERIFY_REJECTS,
  planConfirmAddress,
  screenConfirmAddress,
  stripCountry,
  verifyAuAddress,
  wasCorrected,
} from './verify-address'

const asRes = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

/** A Google Address Validation response body — the fields our parser reads. */
function googleBody(over: {
  formatted?: string | null
  nextAction?: string | null
  unresolvedTokens?: string[]
}) {
  return {
    responseId: 'resp-1',
    result: {
      verdict: {
        ...(over.nextAction ? { possibleNextAction: over.nextAction } : {}),
        validationGranularity: 'PREMISE',
        geocodeGranularity: 'PREMISE',
        addressComplete: true,
      },
      address: {
        formattedAddress: over.formatted ?? undefined,
        missingComponentTypes: [],
        unconfirmedComponentTypes: [],
        unresolvedTokens: over.unresolvedTokens ?? [],
      },
      geocode: { location: { latitude: -30.353, longitude: 153.19 } },
    },
  }
}

const fetchReturning = (status: number, body: unknown) =>
  vi.fn(async () => asRes(status, body))

afterEach(() => vi.unstubAllEnvs())

describe('verifyAuAddress', () => {
  it('is unavailable without an API key (never blocks the flow)', async () => {
    vi.stubEnv('GOOGLE_ADDRESS_VALIDATION_API_KEY', '')
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '')
    const fetchImpl = fetchReturning(200, googleBody({ formatted: 'x' }))
    const v = await verifyAuAddress('15 Fake St', { fetchImpl })
    expect(v.outcome).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is unavailable on HTTP error or network throw', async () => {
    expect(
      (await verifyAuAddress('15 Fake St', { apiKey: 'K', fetchImpl: fetchReturning(403, {}) })).outcome,
    ).toBe('unavailable')
    const boom = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(
      (await verifyAuAddress('15 Fake St', { apiKey: 'K', fetchImpl: boom as never })).outcome,
    ).toBe('unavailable')
  })

  it('matches a clean address and parses postcode + state from the formatted line', async () => {
    const raw = '15 Schofield Dr, Safety Beach NSW 2456'
    const fetchImpl = fetchReturning(
      200,
      googleBody({ formatted: '15 Schofield Dr, Safety Beach NSW 2456, Australia' }),
    )
    const v = await verifyAuAddress(raw, { apiKey: 'K', fetchImpl })
    expect(v).toEqual({
      outcome: 'match',
      formatted: '15 Schofield Dr, Safety Beach NSW 2456',
      postcode: '2456',
      state: 'NSW',
      corrected: false,
    })
  })

  it('flags the live typo scenario as a correction: "safety each" → "Safety Beach"', async () => {
    const raw = '15 Schofield drive safety each'
    const fetchImpl = fetchReturning(
      200,
      googleBody({
        formatted: '15 Schofield Dr, Safety Beach NSW 2456, Australia',
        nextAction: 'CONFIRM',
      }),
    )
    const v = await verifyAuAddress(raw, { apiKey: 'K', fetchImpl })
    expect(v.outcome).toBe('match')
    if (v.outcome === 'match') {
      expect(v.corrected).toBe(true)
      expect(v.formatted).toBe('15 Schofield Dr, Safety Beach NSW 2456')
    }
  })

  it('is not_found when the verdict says FIX or tokens went unresolved', async () => {
    expect(
      (
        await verifyAuAddress('15 Nowhere Pl', {
          apiKey: 'K',
          fetchImpl: fetchReturning(200, googleBody({ formatted: 'Australia', nextAction: 'FIX' })),
        })
      ).outcome,
    ).toBe('not_found')
    expect(
      (
        await verifyAuAddress('15 zzz qqq', {
          apiKey: 'K',
          fetchImpl: fetchReturning(
            200,
            googleBody({ formatted: 'Australia', unresolvedTokens: ['zzz', 'qqq'] }),
          ),
        })
      ).outcome,
    ).toBe('not_found')
  })
})

describe('wasCorrected / stripCountry', () => {
  it('street-type abbreviations and Google-added components are NOT corrections', () => {
    expect(wasCorrected('15 Schofield Drive', '15 Schofield Dr, Safety Beach NSW 2456')).toBe(false)
    expect(wasCorrected('31 greens rd coorparoo', '31 Greens Road, Coorparoo QLD 4151')).toBe(false)
  })
  it('a customer token the map dropped IS a correction', () => {
    expect(wasCorrected('15 Schofield drive safety each', '15 Schofield Dr, Safety Beach NSW 2456')).toBe(true)
  })
  it('stripCountry drops only the trailing country', () => {
    expect(stripCountry('15 Schofield Dr, Safety Beach NSW 2456, Australia')).toBe(
      '15 Schofield Dr, Safety Beach NSW 2456',
    )
  })
})

describe('planConfirmAddress', () => {
  it('keeps the plain read-back when the API is unavailable', () => {
    expect(planConfirmAddress('x', { outcome: 'unavailable' })).toEqual({ kind: 'keep' })
  })
  it('rejects a not-found address with a re-ask that quotes what they typed', () => {
    const p = planConfirmAddress('15 Nowhere Pl', { outcome: 'not_found' })
    expect(p.kind).toBe('reject')
    if (p.kind === 'reject') expect(p.reply).toContain('"15 Nowhere Pl"')
  })
  it('phrases a corrected match as a suggestion, a clean match as the usual confirm', () => {
    const corrected = planConfirmAddress('raw', {
      outcome: 'match',
      formatted: '15 Schofield Dr, Safety Beach NSW 2456',
      postcode: '2456',
      state: 'NSW',
      corrected: true,
    })
    if (corrected.kind === 'confirm') {
      expect(corrected.reply).toContain('closest address I can find')
      expect(corrected.reply).toContain('Reply yes or no')
    } else {
      expect.unreachable('expected confirm')
    }
    const clean = planConfirmAddress('raw', {
      outcome: 'match',
      formatted: '15 Schofield Dr, Safety Beach NSW 2456',
      postcode: '2456',
      state: 'NSW',
      corrected: false,
    })
    if (clean.kind === 'confirm') {
      expect(clean.reply).toContain('Just to confirm, the property is')
    } else {
      expect.unreachable('expected confirm')
    }
  })
})

describe('screenConfirmAddress', () => {
  const MATCH_BODY = googleBody({
    formatted: '15 Schofield Dr, Safety Beach NSW 2456, Australia',
    nextAction: 'CONFIRM',
  })

  it('normalises the slots to the map-verified address and stamps addr_verified', async () => {
    const fetchImpl = fetchReturning(200, MATCH_BODY)
    const slots: AddressSlotsLike = { address: '15 Schofield drive safety each', address_confirmed: false }
    const r = await screenConfirmAddress(slots, { apiKey: 'K', fetchImpl })
    expect(r.slots.address).toBe('15 Schofield Dr, Safety Beach NSW 2456')
    expect(r.slots.postcode).toBe('2456')
    expect(r.slots.state).toBe('NSW')
    expect(r.slots.addr_verified).toBe('15 Schofield Dr, Safety Beach NSW 2456')
    expect(r.step).toBeUndefined()
    expect(r.reply).toContain('closest address I can find')
  })

  it('skips the API for an address that already passed (no double-charge on re-entry)', async () => {
    const fetchImpl = fetchReturning(200, MATCH_BODY)
    const slots = {
      address: '15 Schofield Dr, Safety Beach NSW 2456',
      addr_verified: '15 Schofield Dr, Safety Beach NSW 2456',
    }
    const r = await screenConfirmAddress(slots, { apiKey: 'K', fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r).toEqual({ slots })
  })

  it('rejects a not-found address: clears it, re-asks, and counts the miss', async () => {
    const fetchImpl = fetchReturning(200, googleBody({ formatted: 'Australia', nextAction: 'FIX' }))
    const slots: AddressSlotsLike = { address: '15 Nowhere Pl Nowhereville', postcode: '9999', state: 'NSW' }
    const r = await screenConfirmAddress(slots, { apiKey: 'K', fetchImpl })
    expect(r.step).toBe('address')
    expect(r.reply).toContain("can't find")
    expect(r.slots.address).toBeNull()
    expect(r.slots.postcode).toBeNull()
    expect(r.slots.addr_verify_misses).toBe(1)
  })

  it('stops rejecting after the budget — an unmapped new estate can push through', async () => {
    const fetchImpl = fetchReturning(200, googleBody({ formatted: 'Australia', nextAction: 'FIX' }))
    const slots = {
      address: '3 Brand New Estate Rd',
      addr_verify_misses: MAX_ADDRESS_VERIFY_REJECTS,
    }
    const r = await screenConfirmAddress(slots, { apiKey: 'K', fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r).toEqual({ slots })
  })

  it('keeps the plain read-back untouched when the API is down', async () => {
    const boom = vi.fn(async () => {
      throw new Error('offline')
    })
    const slots = { address: '15 Schofield drive safety each' }
    const r = await screenConfirmAddress(slots, { apiKey: 'K', fetchImpl: boom as never })
    expect(r).toEqual({ slots })
  })
})
