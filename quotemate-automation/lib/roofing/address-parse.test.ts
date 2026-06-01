// Pure AU address-string parsing — every branch of state + postcode
// extraction gets an assertion. These lock in the fix for the
// "QLD address but NSW/2750" form bug (Predictive returns only a
// display string; we derive state + postcode back out of it).

import { describe, expect, it } from 'vitest'
import {
  AU_STATES,
  extractPostcode,
  extractState,
  extractStatePostcode,
  isAuState,
} from './address-parse'

describe('extractStatePostcode — the screenshot case', () => {
  it('pulls QLD + 4155 out of a Chandler display string', () => {
    expect(extractStatePostcode('670 LONDON RD, CHANDLER QLD 4155')).toEqual({
      state: 'QLD',
      postcode: '4155',
    })
  })

  it('pulls NSW + 2750 out of the Penrith fixture Predictive returns', () => {
    expect(extractStatePostcode('27 SMITH ST, PENRITH NSW 2750')).toEqual({
      state: 'NSW',
      postcode: '2750',
    })
  })

  it('handles lower-case / mixed-case input', () => {
    expect(extractStatePostcode('15 George St, Sydney nsw 2000')).toEqual({
      state: 'NSW',
      postcode: '2000',
    })
  })
})

describe('extractStatePostcode — every state, end-of-string tail', () => {
  const CASES: Array<[string, string, string]> = [
    ['1 Test St, Suburb NSW 2000', 'NSW', '2000'],
    ['1 Test St, Suburb VIC 3000', 'VIC', '3000'],
    ['1 Test St, Suburb QLD 4000', 'QLD', '4000'],
    ['1 Test St, Suburb SA 5000', 'SA', '5000'],
    ['1 Test St, Suburb WA 6000', 'WA', '6000'],
    ['1 Test St, Suburb TAS 7000', 'TAS', '7000'],
    ['1 Test St, Suburb ACT 2600', 'ACT', '2600'],
    ['1 Test St, Suburb NT 0800', 'NT', '0800'],
  ]
  for (const [text, state, postcode] of CASES) {
    it(`${state} → ${postcode}`, () => {
      expect(extractStatePostcode(text)).toEqual({ state, postcode })
    })
  }
})

describe('extractStatePostcode — full state names', () => {
  it('maps QUEENSLAND → QLD', () => {
    expect(extractStatePostcode('5 Ann St, Brisbane QUEENSLAND 4000')).toEqual({
      state: 'QLD',
      postcode: '4000',
    })
  })
  it('maps NEW SOUTH WALES → NSW', () => {
    expect(extractStatePostcode('1 Pitt St, Sydney New South Wales 2000')).toEqual({
      state: 'NSW',
      postcode: '2000',
    })
  })
})

describe('extractStatePostcode — guards against false positives', () => {
  it('does not treat a leading street number as a postcode', () => {
    // "1234" is a street number, not a postcode, and there is no state.
    expect(extractStatePostcode('1234 Long Street')).toEqual({
      state: null,
      postcode: null,
    })
  })

  it('does not fire SA inside a suburb like SALISBURY', () => {
    // No standalone state token here — Salisbury contains "SA" but it is
    // not word-bounded, and the suburb has no trailing state/postcode.
    const r = extractStatePostcode('10 Main Rd, Salisbury')
    expect(r.state).toBeNull()
  })

  it('does not fire WA inside WARWICK', () => {
    const r = extractStatePostcode('3 Hill St, Warwick')
    expect(r.state).toBeNull()
  })

  it('still finds the real state even when the suburb embeds a state substring', () => {
    // Salisbury (embeds SA) is the suburb; SA is the real trailing state.
    expect(extractStatePostcode('10 Main Rd, Salisbury SA 5108')).toEqual({
      state: 'SA',
      postcode: '5108',
    })
  })

  it('rejects sub-0200 four-digit numbers as postcodes', () => {
    expect(extractStatePostcode('100 Park Ave, Town 0100')).toEqual({
      state: null,
      postcode: null,
    })
  })
})

describe('extractStatePostcode — partial / missing data', () => {
  it('returns the state but null postcode when no postcode present', () => {
    expect(extractStatePostcode('12 Beach Rd, Bondi NSW')).toEqual({
      state: 'NSW',
      postcode: null,
    })
  })

  it('returns the postcode but null state when state is absent', () => {
    // End-anchored 4-digit token with no state → still a postcode.
    expect(extractStatePostcode('12 Beach Rd, Bondi 2026')).toEqual({
      state: null,
      postcode: '2026',
    })
  })

  it('returns nulls for empty / nullish input', () => {
    expect(extractStatePostcode('')).toEqual({ state: null, postcode: null })
    expect(extractStatePostcode(null)).toEqual({ state: null, postcode: null })
    expect(extractStatePostcode(undefined)).toEqual({ state: null, postcode: null })
  })
})

describe('extractState — last occurrence wins', () => {
  it('picks the trailing state token, not one embedded earlier', () => {
    // "VICTORIA ST" is a street; the real state is NSW at the tail.
    const r = extractState('10 VICTORIA ST, REDFERN NSW 2016')
    expect(r.state).toBe('NSW')
  })
})

describe('extractPostcode — needs a state anchor or an end anchor', () => {
  it('takes the 4-digit token after the state index', () => {
    const upper = '670 LONDON RD, CHANDLER QLD 4155'
    const { endIndex } = extractState(upper)
    expect(extractPostcode(upper, endIndex)).toBe('4155')
  })
  it('takes an end-anchored token when there is no state', () => {
    expect(extractPostcode('SOME PLACE 2000', -1)).toBe('2000')
  })
  it('ignores a mid-string number with no state and no end anchor', () => {
    expect(extractPostcode('1234 SMITH ST APT 5', -1)).toBeNull()
  })
})

describe('isAuState', () => {
  it('accepts the eight abbreviations', () => {
    for (const s of AU_STATES) expect(isAuState(s)).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isAuState('NEW SOUTH WALES')).toBe(false)
    expect(isAuState('xx')).toBe(false)
    expect(isAuState(null)).toBe(false)
    expect(isAuState(undefined)).toBe(false)
  })
})
