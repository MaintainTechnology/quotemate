// screenAddressForAutoRun — may we run the measure/estimate WITHOUT a
// text read-back, because the caller already agreed the address on the phone?
//
// Written after a shipped inversion (2026-07-23): the voice path used
// `screenConfirmAddress`'s `reply` as a "was it clean?" predicate, but that
// function returns a reply for EVERY successful verification (planConfirmAddress
// → kind:'confirm' always carries the read-back question). So a clean match
// looked like a correction and downgraded to "ask", while an UNVERIFIED
// address (API down → kind:'keep', no reply) was the only case that measured
// — exactly backwards on both counts.
//
// These tests drive the REAL verifier through its injectable fetch, so a
// mock can never again paper over the real return shape.

import { describe, expect, it } from 'vitest'
import { screenAddressForAutoRun, type AddressSlotsLike } from './verify-address'

const slotsOf = (address: string | null): AddressSlotsLike => ({ address })

const RAW = '670 London Road, Chandler QLD 4155'

/** A Google Address Validation response, shaped like the live API. */
function googleResponse(body: unknown) {
  return async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function verdict(formatted: string, extra: Record<string, unknown> = {}) {
  return {
    result: {
      verdict: { addressComplete: true, hasUnconfirmedComponents: false },
      address: {
        formattedAddress: formatted,
        addressComponents: [],
        ...(extra.address ?? {}),
      },
      ...extra,
    },
  }
}

const opts = (body: unknown) => ({ apiKey: 'test-key', fetchImpl: googleResponse(body) as never })

describe('screenAddressForAutoRun', () => {
  it('clean, uncorrected match → proceed (this is the case that must measure)', async () => {
    const out = await screenAddressForAutoRun(
      slotsOf(RAW),
      opts(verdict('670 London Road, Chandler QLD 4155, Australia')),
    )
    expect(out.kind).toBe('proceed')
    if (out.kind !== 'proceed') return
    // Google's formatted string is adopted and stamped so the SMS machine
    // never re-verifies the same string.
    expect(out.slots.address).toBe('670 London Road, Chandler QLD 4155')
    expect(out.slots.addr_verified).toBe('670 London Road, Chandler QLD 4155')
    expect(out.slots.address_confirmed).toBe(true)
  })

  it('Google CORRECTED the address → confirm by text, never auto-run', async () => {
    const out = await screenAddressForAutoRun(
      slotsOf('15 Schofield Drive, Safety Each QLD'),
      opts(verdict('15 Schofield Drive, Safety Beach VIC 3936, Australia')),
    )
    expect(out.kind).toBe('confirm')
    if (out.kind !== 'confirm') return
    expect(out.reply).toMatch(/closest address I can find/i)
    expect(out.slots.address_confirmed).toBe(false)
  })

  it('address not on the map → reject and re-ask, never auto-run', async () => {
    const out = await screenAddressForAutoRun(
      slotsOf('999 Nowhere Street, Nowheresville QLD'),
      opts({
        result: {
          verdict: { possibleNextAction: 'FIX', addressComplete: false },
          address: { formattedAddress: '', unresolvedTokens: ['Nowheresville'] },
        },
      }),
    )
    expect(out.kind).toBe('reject')
    if (out.kind !== 'reject') return
    expect(out.reply).toMatch(/can't find/i)
  })

  it('Google echoed an UNCONFIRMED suburb → confirm by text (the 223 Archer St guard)', async () => {
    // Live 2026-07-23: "223 Archer St, Chandler" came back ACCEPT with every
    // typed token intact, but unconfirmedComponentTypes ['locality'] — the
    // suburb was never verified (the real one is Gumdale). String comparison
    // alone sees a clean match, so this MUST come from the verification's
    // own `corrected` flag or we auto-measure the wrong suburb.
    const out = await screenAddressForAutoRun(
      slotsOf('223 Archer St, Chandler QLD 4154'),
      opts({
        result: {
          verdict: { addressComplete: true },
          address: {
            formattedAddress: '223 Archer Street, Chandler QLD 4154, Australia',
            unconfirmedComponentTypes: ['locality'],
          },
        },
      }),
    )
    expect(out.kind).toBe('confirm')
  })

  it('verification unavailable → proceed on the caller\'s own words (never a dead end)', async () => {
    const out = await screenAddressForAutoRun(slotsOf(RAW), { apiKey: undefined })
    expect(out.kind).toBe('proceed')
    if (out.kind !== 'proceed') return
    expect(out.slots.address).toBe(RAW)
  })

  it('no address → reject (nothing to run)', async () => {
    const out = await screenAddressForAutoRun(slotsOf(null), opts(verdict('x')))
    expect(out.kind).toBe('reject')
  })
})
