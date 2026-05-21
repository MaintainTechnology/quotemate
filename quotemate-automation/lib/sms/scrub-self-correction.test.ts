// Deterministic safety net for the mid-message self-correction the SMS
// dialog model occasionally emits. Observed in the 2026-05-20 AND
// 2026-05-21 n8n sweeps on the washing-machine-taps prompt:
//   "Is the new shower head... wait, wrong job. For the washing machine
//    taps: is the new tapware supplied by you, or by us?"
// The customer must never see the "wait, wrong job" stumble.

import { describe, expect, it } from 'vitest'
import { scrubSelfCorrection } from './dialog'

describe('scrubSelfCorrection', () => {
  it('salvages the clean reply after a "wrong job" self-correction', () => {
    const dirty =
      'Is the new shower head... wait, wrong job. For the washing machine taps: is the new tapware supplied by you, or do you want the plumber to supply?'
    const clean = scrubSelfCorrection(dirty)
    expect(clean).not.toMatch(/wrong job/i)
    expect(clean).not.toMatch(/\bwait\b/i)
    expect(clean).toBe(
      'For the washing machine taps: is the new tapware supplied by you, or do you want the plumber to supply?',
    )
  })

  it('handles "wrong service" phrasing + a colon separator', () => {
    const dirty = 'Quick one on the downlights... wrong service: how many garden taps did you need?'
    expect(scrubSelfCorrection(dirty)).toBe('How many garden taps did you need?')
  })

  it('capitalises the salvaged fragment when it starts lowercase', () => {
    const dirty = 'something about ovens, wrong job - which room are the fans going in?'
    expect(scrubSelfCorrection(dirty)).toBe('Which room are the fans going in?')
  })

  it('leaves a clean reply untouched', () => {
    const clean = 'Welcome back Sam - 6 downlights in the kitchen, got it. What is the ceiling like?'
    expect(scrubSelfCorrection(clean)).toBe(clean)
  })

  it('does NOT touch a legitimate "actually" (e.g. the aircon service match)', () => {
    // T005 in the sweep: "that's actually our Install aircon power point
    // service" — a correct, intentional use. Must survive.
    const legit = "Welcome back Sam - that's actually our Install aircon power point service. How many head units?"
    expect(scrubSelfCorrection(legit)).toBe(legit)
  })

  it('does not salvage when the post-correction fragment is too short', () => {
    // Nothing useful after the marker → leave the original rather than
    // emit a stub.
    const dirty = 'Hmm, wrong job. ok'
    expect(scrubSelfCorrection(dirty)).toBe(dirty)
  })

  it('is idempotent', () => {
    const dirty = 'Is the new shower head... wait, wrong job. For the washing machine taps: supplied by you or us?'
    const once = scrubSelfCorrection(dirty)
    expect(scrubSelfCorrection(once)).toBe(once)
  })
})
