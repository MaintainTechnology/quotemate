// ═══════════════════════════════════════════════════════════════════
// Regression: an EV charger quote must NOT be flagged [spec-guard].
//
// Live 2026-09-04 (Sparky, +61468048422). A complete, grounded EV
// charger quote ($450/$560, needs_inspection=false) was written with
// status='awaiting_tradie_approval' and never sent. Cause chain:
//
//   getSpecDefs('electrical','ev_charger') === []            (no registry entry)
//     -> spec-guard's `defKeys.size > 0 ? ... : reqKeys` fallback
//        compared EVERY requested spec key
//     -> canonicalise() has no grammar for charger_model /
//        cable_run_metres, so both sides fell through to the lowercase
//        passthrough and the PRODUCT side was the whole description
//     -> equality could never hold -> 'mismatch'
//     -> run.ts appended '[spec-guard] ...' to risk_flags
//     -> safetyReviewReasons() -> 'spec_guard'
//     -> shouldHoldForReview() -> hold, overriding review_policy='auto_send'
//     -> customer was told "your quote's on its way" and got silence.
//
// The requested/product strings below are the verbatim live values.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest'
import { reconcileProductSpecs } from './spec-guard'
import { getSpecDefs, canonicalise } from './spec-registry'
import { shouldHoldForReview, safetyReviewReasons } from '../quote/review-policy'

/** Verbatim from the live intake's conversation_state.slots.requested_specs. */
const REQUESTED = {
  phase: 'single-phase',
  charger_model: 'Tesla Wall Connector',
  spare_capacity: 'unknown',
  cable_run_metres: '8',
}

/** Verbatim line-item description from the live quote. */
const PRODUCT_NAME =
  'Customer to supply - Tesla Wall Connector EV charger install on new dedicated ' +
  'single-phase circuit (Install EV charger assembly)'

describe('spec-guard — EV charger', () => {
  it('registers ev_charger with phase as its only checked spec', () => {
    const keys = getSpecDefs('electrical', 'ev_charger').map((d) => d.key)
    expect(keys).toEqual(['phase'])
    // Free text and job dimensions must stay out — they are not product props.
    expect(keys).not.toContain('charger_model')
    expect(keys).not.toContain('cable_run_metres')
  })

  it('does NOT flag a mismatch on the real EV charger product', () => {
    const r = reconcileProductSpecs({
      requested: REQUESTED,
      properties: {},
      name: PRODUCT_NAME,
      trade: 'electrical',
      category: 'ev_charger',
    })
    expect(r.verdict).not.toBe('mismatch')
    expect(r.conflicts).toHaveLength(0)
  })

  it('still matches phase from the product description', () => {
    expect(canonicalise('phase', PRODUCT_NAME)).toBe('single-phase')
    expect(canonicalise('phase', 'single-phase')).toBe('single-phase')
  })

  it('DOES still flag a genuine phase contradiction', () => {
    const r = reconcileProductSpecs({
      requested: { ...REQUESTED, phase: 'three-phase' },
      properties: {},
      name: PRODUCT_NAME, // single-phase product
      trade: 'electrical',
      category: 'ev_charger',
    })
    expect(r.verdict).toBe('mismatch')
  })

  // The whole point of the fix: no spec_guard flag => auto_send is honoured.
  it('leaves an auto_send tenant free to send the quote', () => {
    expect(safetyReviewReasons([])).toEqual([])
    expect(
      shouldHoldForReview({ policy: 'auto_send', riskFlags: [], totalIncGst: 495 }),
    ).toEqual({ hold: false, reason: 'tenant_policy_auto_send' })
  })

  it('a category with no SpecDefs checks nothing rather than everything', () => {
    // smoke_alarm has no SPEC_DEFS entry — it must not resurrect the
    // compare-everything fallback that broke ev_charger.
    expect(getSpecDefs('electrical', 'smoke_alarm')).toEqual([])
    const r = reconcileProductSpecs({
      requested: { some_free_text: 'anything at all', another: 'value' },
      properties: {},
      name: 'Hardwire 240V smoke alarm (whole-house compliance install)',
      trade: 'electrical',
      category: 'smoke_alarm',
    })
    expect(r.verdict).not.toBe('mismatch')
  })
})
