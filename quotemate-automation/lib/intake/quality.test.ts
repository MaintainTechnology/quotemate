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
import { evaluateIntakeQuality, missingRequiredFields } from './quality'

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

// ──────────────────────────────────────────────────────────────────────
// R28 — per-job confidence gating
//
// Even when the universal gate (name + scope present) passes, a quote can
// be ungroundable if a field that is MANDATORY for the specific job type
// was never captured. The headline case: a "downlights" intake with a name
// and a scope sentence but NO count. The estimator can't size labour or
// materials without it, so we downgrade to 'empty' to fire the recovery /
// callback path instead of drafting off a silently-assumed count.
//
// Rules under test:
//   • per-job gate only DOWNGRADES — never raises confidence, never
//     overrides MEDIUM/HIGH certification.
//   • the count is satisfied by EITHER scope.item_count OR a digit in the
//     scope description (so we don't re-ask a customer who already said it).
describe('evaluateIntakeQuality — R28 per-job gating', () => {
  const baseDownlights = {
    confidence: 'LOW' as const,
    caller: { name: 'James' },
    job_type: 'downlights',
  }

  it('downgrades a downlights intake missing count (no item_count, no number in scope)', () => {
    // Name + a >=10 char scope present → universal gate would pass. But the
    // count is nowhere → per-job gate downgrades to 'empty'.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        scope: { description: 'install some downlights in the kitchen please' },
      }),
    ).toBe('empty')
  })

  it('does NOT downgrade a complete downlights intake (item_count present)', () => {
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        scope: {
          description: 'install downlights in the kitchen please',
          item_count: 6,
        },
      }),
    ).toBe('usable')
  })

  it('does NOT downgrade when the count is stated in the scope prose (digit present)', () => {
    // Mirrors the parity-harness "5 downlights in kitchen" case — the
    // structurer may leave item_count undefined when the number is in
    // the customer's own words. We must not re-ask them.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        scope: { description: '5 downlights in the kitchen' },
      }),
    ).toBe('usable')
  })

  it('applies the same count requirement to the other count-based easy-5 jobs', () => {
    for (const job_type of ['power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting']) {
      // Missing count → downgraded.
      expect(
        evaluateIntakeQuality({
          confidence: 'LOW',
          caller: { name: 'James' },
          job_type,
          scope: { description: 'work needed in the lounge room area' },
        }),
      ).toBe('empty')
      // Count present → usable.
      expect(
        evaluateIntakeQuality({
          confidence: 'LOW',
          caller: { name: 'James' },
          job_type,
          scope: { description: 'work needed in the lounge', item_count: 2 },
        }),
      ).toBe('usable')
    }
  })

  // ── R28 MEDIUM-band conformance (FIX 3b, 2026-06-18) ────────────────
  // R28 requires lowering confidence when a mandatory STRUCTURED field is
  // missing for MEDIUM/LOW. The per-job gate now runs for MEDIUM too — a
  // discrete field like the count can be absent even when the model rates
  // overall signal MEDIUM, and the estimator can't size the quote without
  // it. HIGH remains sacrosanct and is NEVER downgraded.
  it('FIX 3b: MEDIUM downlights WITHOUT a count is downgraded to empty', () => {
    // No item_count, no digit in scope → per-job gate downgrades MEDIUM.
    // Safe because the recovery SMS now asks the exact count question.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        confidence: 'MEDIUM',
        scope: { description: 'install some downlights in the kitchen please' },
      }),
    ).toBe('empty')
  })

  it('FIX 3b: MEDIUM downlights WITH a count stays usable (not downgraded)', () => {
    // item_count present → MEDIUM passes. Negative half of the pair: the
    // gate must not over-block a MEDIUM intake that DOES carry the count.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        confidence: 'MEDIUM',
        scope: { description: 'install downlights in the kitchen please', item_count: 6 },
      }),
    ).toBe('usable')
    // Digit-in-prose count also satisfies it for MEDIUM.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        confidence: 'MEDIUM',
        scope: { description: '6 downlights in the kitchen please' },
      }),
    ).toBe('usable')
  })

  it('FIX 3b: HIGH is NEVER downgraded, even without a count', () => {
    // Top-band certification is sacrosanct — the per-job gate must not
    // touch HIGH regardless of a missing structured field.
    expect(
      evaluateIntakeQuality({
        ...baseDownlights,
        confidence: 'HIGH',
        scope: { description: 'install some downlights in the kitchen please' },
      }),
    ).toBe('usable')
  })

  it('FIX 3b: MEDIUM with no per-job requirement is unaffected (no over-block)', () => {
    // A MEDIUM job type with no count requirement (other / plumbing) must
    // still be usable — 3b only adds the structured-field check, it does
    // NOT start re-running the universal name/scope gate for MEDIUM.
    expect(
      evaluateIntakeQuality({
        confidence: 'MEDIUM',
        caller: { name: 'James' },
        job_type: 'other',
        scope: { description: 'install customer-supplied insect zapper hung from ceiling' },
      }),
    ).toBe('usable')
    expect(
      evaluateIntakeQuality({
        confidence: 'MEDIUM',
        caller: { name: 'James' },
        job_type: 'blocked_drain',
        scope: { description: 'kitchen sink is completely blocked' },
      }),
    ).toBe('usable')
    // MEDIUM must NOT re-run the universal name check: even a blank name on
    // a non-count job stays usable (the model certified MEDIUM signal).
    expect(
      evaluateIntakeQuality({
        confidence: 'MEDIUM',
        caller: { name: '' },
        job_type: 'other',
        scope: { description: 'x' },
      }),
    ).toBe('usable')
  })

  it('does NOT add a per-job requirement to non-count jobs (preserves bug-zapper fix)', () => {
    // job_type='other' and plumbing-style jobs have no count requirement,
    // so a usable name + scope still passes — no new downgrade introduced.
    expect(
      evaluateIntakeQuality({
        confidence: 'LOW',
        caller: { name: 'James' },
        job_type: 'other',
        scope: { description: 'install customer-supplied insect zapper hung from ceiling' },
      }),
    ).toBe('usable')
    expect(
      evaluateIntakeQuality({
        confidence: 'LOW',
        caller: { name: 'James' },
        job_type: 'blocked_drain',
        scope: { description: 'kitchen sink is completely blocked and not draining' },
      }),
    ).toBe('usable')
  })

  it('a missing universal field still wins over the per-job gate (no double-counting)', () => {
    // Missing name → 'empty' from the universal gate regardless of count.
    expect(
      evaluateIntakeQuality({
        confidence: 'LOW',
        caller: { name: '' },
        job_type: 'downlights',
        scope: { description: '6 downlights in the kitchen', item_count: 6 },
      }),
    ).toBe('empty')
  })
})

describe('missingRequiredFields', () => {
  it("reports ['count'] for a downlights intake with no count signal", () => {
    expect(
      missingRequiredFields({
        confidence: 'LOW',
        caller: { name: 'James' },
        job_type: 'downlights',
        scope: { description: 'install some downlights please' },
      }),
    ).toEqual(['count'])
  })

  it('reports nothing when the count is present', () => {
    expect(
      missingRequiredFields({
        confidence: 'LOW',
        caller: { name: 'James' },
        job_type: 'downlights',
        scope: { description: 'install downlights', item_count: 4 },
      }),
    ).toEqual([])
  })

  it('reports nothing for a job type with no per-job requirements', () => {
    expect(
      missingRequiredFields({
        confidence: 'LOW',
        caller: { name: 'James' },
        job_type: 'other',
        scope: { description: 'something custom' },
      }),
    ).toEqual([])
  })

  it("reports ['count'] for a MEDIUM downlights intake too (band-agnostic)", () => {
    // FIX 3b relies on missingRequiredFields being band-agnostic so the
    // structure route can fold the gap into the recovery missing[] set for
    // MEDIUM, not just LOW.
    expect(
      missingRequiredFields({
        confidence: 'MEDIUM',
        caller: { name: 'James' },
        job_type: 'downlights',
        scope: { description: 'install some downlights please' },
      }),
    ).toEqual(['count'])
  })
})
