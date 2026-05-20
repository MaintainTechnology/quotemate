// Regression coverage for the quality gate.
//
// Headline case (2026-05-19, "bug zapper"): a tenant-custom assembly
// finished the dialog cleanly (name + suburb + scope captured) but the
// gate flagged the intake 'empty' because Opus structured it as
// job_type='other' (the enum has no "insect zapper"). Result: the
// customer was re-asked "what kind of work?" right after confirming
// every detail. The gate now treats job_type='other' as quotable when
// name + scope are usable — the downstream estimator + grounding
// validator decide whether to draft or escalate to inspection.

import { describe, expect, it } from 'vitest'
import { evaluateIntakeQuality } from './quality'

const baseLow = {
  confidence: 'LOW' as const,
  caller: { name: 'James' },
  scope: { description: 'Install customer-supplied 10A insect zapper, hung from ceiling' },
  job_type: 'other',
}

describe('evaluateIntakeQuality', () => {
  it('non-LOW confidence is always usable', () => {
    expect(evaluateIntakeQuality({ ...baseLow, confidence: 'MEDIUM' })).toBe('usable')
    expect(evaluateIntakeQuality({ ...baseLow, confidence: 'HIGH' })).toBe('usable')
  })

  it("BUG-ZAPPER FIX: LOW + job_type='other' + name + scope is USABLE", () => {
    // Before fix: returned 'empty' → recovery SMS asking "what kind of work?".
    // After fix: usable → downstream estimator/validator decides next step.
    expect(evaluateIntakeQuality(baseLow)).toBe('usable')
  })

  it('LOW + missing name is empty', () => {
    expect(evaluateIntakeQuality({ ...baseLow, caller: { name: '' } })).toBe('empty')
    expect(evaluateIntakeQuality({ ...baseLow, caller: null })).toBe('empty')
    expect(evaluateIntakeQuality({ ...baseLow, caller: { name: 'unknown' } })).toBe('empty')
    expect(evaluateIntakeQuality({ ...baseLow, caller: { name: 'J' } })).toBe('empty')
  })

  it('LOW + scope shorter than 10 chars is empty', () => {
    expect(evaluateIntakeQuality({ ...baseLow, scope: { description: 'short' } })).toBe('empty')
    expect(evaluateIntakeQuality({ ...baseLow, scope: null })).toBe('empty')
    expect(evaluateIntakeQuality({ ...baseLow, scope: { description: '' } })).toBe('empty')
  })

  it("LOW + a recognised job_type still passes even without a long scope as long as scope is present", () => {
    expect(
      evaluateIntakeQuality({
        ...baseLow,
        job_type: 'downlights',
        scope: { description: '6 downlights kitchen' },
      }),
    ).toBe('usable')
  })

  it("LOW + job_type='other' is empty when scope is missing (genuine no-info case)", () => {
    expect(
      evaluateIntakeQuality({
        ...baseLow,
        job_type: 'other',
        scope: { description: '' },
      }),
    ).toBe('empty')
  })
})
