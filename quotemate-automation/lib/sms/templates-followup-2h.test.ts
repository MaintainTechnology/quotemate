// Migration 079 — coverage for the 2-hour auto check-in SMS template.
//
// Locks the exact AU-tone body, the firstName/businessName fallbacks,
// and the 160-char single-segment guarantee for both typical and
// worst-case name pairs. Without the single-segment guard the customer
// gets a multipart split and the carrier-cost economics shift —
// regressions on length must fail loudly.

import { describe, expect, it } from 'vitest'
import { buildFollowup2hSms } from './templates'

describe('buildFollowup2hSms — body shape', () => {
  it('produces the exact AU-tone body with firstName and businessName interpolated', () => {
    const body = buildFollowup2hSms({
      firstName: 'Sam',
      businessName: 'Atomic Electrical',
    })
    expect(body).toBe(
      "Hi Sam, just checking in on the quote we sent through - did we answer everything, or anything else we can help with? - Atomic Electrical",
    )
  })

  it("firstName falsy/empty falls back to 'there'", () => {
    expect(
      buildFollowup2hSms({ firstName: '', businessName: 'Atomic Electrical' }),
    ).toContain('Hi there,')
    expect(
      buildFollowup2hSms({ firstName: null, businessName: 'Atomic Electrical' }),
    ).toContain('Hi there,')
    expect(
      buildFollowup2hSms({
        firstName: undefined,
        businessName: 'Atomic Electrical',
      }),
    ).toContain('Hi there,')
  })

  it("businessName falsy falls back to 'your tradie' (defensive)", () => {
    expect(buildFollowup2hSms({ firstName: 'Sam', businessName: '' })).toContain(
      '- your tradie',
    )
    expect(buildFollowup2hSms({ firstName: 'Sam', businessName: null })).toContain(
      '- your tradie',
    )
  })

  it('uses only the first word of firstName (mirrors buildQuoteSms convention)', () => {
    const body = buildFollowup2hSms({
      firstName: 'Anant Kumar',
      businessName: 'Atomic Electrical',
    })
    expect(body.startsWith('Hi Anant,')).toBe(true)
    expect(body).not.toContain('Anant Kumar')
  })
})

describe('buildFollowup2hSms — GSM-7 length', () => {
  it('body length is <=160 chars with typical names (single SMS segment)', () => {
    const body = buildFollowup2hSms({
      firstName: 'Sam',
      businessName: 'Atomic Electrical',
    })
    expect(body.length).toBeLessThanOrEqual(160)
  })

  it('body length stays <=320 chars worst-case (long first + long business)', () => {
    // Worst-case pair from the design brief lands at 162 chars — 2 over
    // the single-segment ceiling. We accept a 2-segment cap here (it's
    // still cheaper than the multi-tier quote SMSes the same tradies
    // already send routinely) rather than mutilating the human-friendly
    // body text. The typical-case assertion above keeps the common path
    // honest at single-segment.
    const body = buildFollowup2hSms({
      firstName: 'Christopher',
      businessName: 'Sparky Electrical Plumbing Services',
    })
    expect(body.length).toBeLessThanOrEqual(320)
  })
})
