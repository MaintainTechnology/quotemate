// US-003 — STOP was only honoured inside the roofing/painting
// receptionists, per-conversation. A standard Twilio opt-out keyword must
// end the thread on EVERY conversation type (2026-07-23 audit). Twilio
// carrier-blocks the number after these keywords (error 21610 on send),
// so the correct behaviour is silence + close — a reply would fail anyway.

import { describe, it, expect } from 'vitest'
import { isGlobalOptOut } from './inbound-helpers'

describe('isGlobalOptOut', () => {
  it('matches the standard Twilio opt-out keywords as the whole message', () => {
    for (const k of ['STOP', 'stop', ' Stop ', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'stop.', 'Stop!']) {
      expect(isGlobalOptOut(k), k).toBe(true)
    }
  })

  it('does NOT match the keyword inside a sentence — that is conversation, not opt-out', () => {
    // Twilio itself only treats single-word messages as opt-outs; a phrase
    // like "let's cancel the booking" must reach the dialog/receptionist,
    // which has the polite-cancel path.
    for (const s of [
      "let's cancel the booking",
      'can you stop by tomorrow',
      'stop the leak please',
      'end of the driveway',
      'I want to cancel my quote and get a new one',
    ]) {
      expect(isGlobalOptOut(s), s).toBe(false)
    }
  })

  it('empty / null-ish input is not an opt-out', () => {
    expect(isGlobalOptOut('')).toBe(false)
    expect(isGlobalOptOut('   ')).toBe(false)
  })
})
