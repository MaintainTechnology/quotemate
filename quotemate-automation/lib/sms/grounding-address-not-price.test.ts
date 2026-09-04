// ═══════════════════════════════════════════════════════════════════
// Regression: a STREET NUMBER after "for" is not a price.
//
// Live 2026-09-04 (Sparky, +61468048422). The receptionist's own
// confirmation turn was:
//
//   "Beauty Jeph, that's all locked in for 14 Wilson St, Newtown.
//    Photo link's on its way now for that install spot, quote will
//    follow once we've had a look. Cheers."
//
// MONEY_CONTEXT's trailing `\bfor\s+\d{2,}\b` matched "for 14", so
// assertGroundedReply returned { ok:false, reason:'the model wrote a
// price' }. Two customer-visible consequences on that one turn:
//   1. the confirmation was discarded and replaced with the generic
//      "hit a quick snag on this turn" fallback;
//   2. step 8b logged 'photo-request SMS skipped — the model wrote a
//      price', so the EV location-photo link was never sent even
//      though the reply had just promised it.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { assertGroundedReply } from './llm-receptionist'

/** The verbatim discarded reply, and the slots that grounded it. */
const LIVE_REPLY =
  "Beauty Jeph, that's all locked in for 14 Wilson St, Newtown. Photo link's on its way " +
  'now for that install spot, quote will follow once we\'ve had a look. Cheers.'
const AUTHORITATIVE = ['14 Wilson St, Newtown NSW 2042', 'ev_charger', 'Tesla Wall Connector']

describe('assertGroundedReply — street number is not a price', () => {
  it('accepts the live confirmation that was wrongly discarded', () => {
    const r = assertGroundedReply(LIVE_REPLY, AUTHORITATIVE, ['14 Wilson St, Newtown NSW 2042'])
    expect(r.ok).toBe(true)
  })

  it('accepts other "for <street number> <Street>" phrasings', () => {
    for (const reply of [
      'All booked for 28 Greens Rd, Coorparoo. Cheers.',
      "Righto — quote's coming for 102 Smith Street.",
      'Locked in for 14 Wilson St.',
    ]) {
      expect(assertGroundedReply(reply, ['28 Greens Rd, Coorparoo', '102 Smith Street', '14 Wilson St']).ok)
        .toBe(true)
    }
  })

  // The alternative still has to do its actual job.
  it('STILL refuses an unsigned price after "for"', () => {
    for (const reply of [
      'Yeah we can do it for 450 installed.',
      "I'll do the lot for 1200.",
      'Happy to do it for 450.',
    ]) {
      const r = assertGroundedReply(reply, [])
      expect(r.ok, reply).toBe(false)
    }
  })

  it('STILL refuses explicit money in every other form', () => {
    for (const reply of [
      'That comes to $450.',
      "It's 450 dollars all up.",
      'We can take a 30% deposit.',
      "That'll be about two thousand.",
      'The call-out rate is 150 an hour.',
    ]) {
      expect(assertGroundedReply(reply, []).ok, reply).toBe(false)
    }
  })
})
