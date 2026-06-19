import { describe, it, expect } from 'vitest'
import {
  clarifyingEnforcementEnabled,
  clarifyingTurnCap,
  decideClarifyGate,
} from './quote-readiness'

// R24 safety valve — feature flag + clarifying-turn cap for the deterministic
// readiness override in app/api/sms/inbound/route.ts.

describe('clarifyingEnforcementEnabled (R24 kill switch)', () => {
  it('defaults ON when the env var is absent/blank', () => {
    expect(clarifyingEnforcementEnabled({})).toBe(true)
    expect(clarifyingEnforcementEnabled({ SMS_ENFORCE_CLARIFYING_QUESTIONS: '' })).toBe(true)
    expect(clarifyingEnforcementEnabled({ SMS_ENFORCE_CLARIFYING_QUESTIONS: '1' })).toBe(true)
  })

  it('disables on the documented kill-switch values (case-insensitive)', () => {
    for (const v of ['0', 'off', 'false', 'no', 'OFF', 'False', 'No']) {
      expect(clarifyingEnforcementEnabled({ SMS_ENFORCE_CLARIFYING_QUESTIONS: v })).toBe(false)
    }
  })

  it('treats any other value as ON (fail-safe to the built behaviour)', () => {
    expect(clarifyingEnforcementEnabled({ SMS_ENFORCE_CLARIFYING_QUESTIONS: 'yes' })).toBe(true)
    expect(clarifyingEnforcementEnabled({ SMS_ENFORCE_CLARIFYING_QUESTIONS: 'garbage' })).toBe(true)
  })
})

describe('clarifyingTurnCap (R24 turn cap)', () => {
  it('defaults to 6 when unset or out of range', () => {
    expect(clarifyingTurnCap({})).toBe(6)
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: '' })).toBe(6)
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: '0' })).toBe(6)
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: '21' })).toBe(6)
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: 'nope' })).toBe(6)
  })

  it('honours an explicit value within [1,20]', () => {
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: '3' })).toBe(3)
    expect(clarifyingTurnCap({ SMS_CLARIFYING_TURN_CAP: '20' })).toBe(20)
  })
})

describe('decideClarifyGate (R24 deterministic decision)', () => {
  it('allows (kill switch) when enforcement is off — count resets to 0', () => {
    expect(decideClarifyGate({ priorCount: 4, enforcementEnabled: false, cap: 6 })).toEqual({
      mode: 'allow',
      count: 0,
    })
  })

  it('asks (and increments) below the cap', () => {
    expect(decideClarifyGate({ priorCount: 0, enforcementEnabled: true, cap: 6 })).toEqual({
      mode: 'ask',
      count: 1,
    })
    expect(decideClarifyGate({ priorCount: 4, enforcementEnabled: true, cap: 6 })).toEqual({
      mode: 'ask',
      count: 5,
    })
  })

  it('escalates to inspection when the next count reaches the cap (never loops forever)', () => {
    expect(decideClarifyGate({ priorCount: 5, enforcementEnabled: true, cap: 6 })).toEqual({
      mode: 'escalate',
      count: 6,
    })
    // small cap proves the loop always terminates
    expect(decideClarifyGate({ priorCount: 1, enforcementEnabled: true, cap: 2 })).toEqual({
      mode: 'escalate',
      count: 2,
    })
  })

  it('treats a non-finite prior count as 0', () => {
    expect(decideClarifyGate({ priorCount: NaN, enforcementEnabled: true, cap: 6 })).toEqual({
      mode: 'ask',
      count: 1,
    })
  })

  // R19 — only consecutive NO-PROGRESS turns count toward the cap.
  it('a productive turn (madeProgress) resets the stuck-counter to 0', () => {
    expect(decideClarifyGate({ priorCount: 5, enforcementEnabled: true, cap: 6, madeProgress: true }))
      .toEqual({ mode: 'ask', count: 0 })
  })

  it('a cooperative-but-slow customer near the cap never escalates while making progress', () => {
    // would have escalated (priorCount 5, cap 6) but they answered something
    expect(decideClarifyGate({ priorCount: 5, enforcementEnabled: true, cap: 2, madeProgress: true }))
      .toEqual({ mode: 'ask', count: 0 })
  })

  it('a genuinely stuck customer (no progress) still escalates at the cap', () => {
    expect(decideClarifyGate({ priorCount: 5, enforcementEnabled: true, cap: 6, madeProgress: false }))
      .toEqual({ mode: 'escalate', count: 6 })
  })
})
