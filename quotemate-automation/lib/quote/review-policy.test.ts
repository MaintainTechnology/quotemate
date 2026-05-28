// Tests for the pure review-policy module.
// No DB, no fetch — just the hold-vs-send decision.

import { describe, expect, it } from 'vitest'
import {
  asReviewPolicy,
  shouldHoldForReview,
  REVIEW_POLICIES,
} from './review-policy'

describe('REVIEW_POLICIES', () => {
  it('exports exactly three policies', () => {
    expect(REVIEW_POLICIES).toEqual([
      'auto_send',
      'always_review',
      'review_over_threshold',
    ])
  })
})

describe('asReviewPolicy', () => {
  it('accepts each valid policy verbatim', () => {
    expect(asReviewPolicy('auto_send')).toBe('auto_send')
    expect(asReviewPolicy('always_review')).toBe('always_review')
    expect(asReviewPolicy('review_over_threshold')).toBe('review_over_threshold')
  })

  it('falls back to auto_send for invalid input (back-compat with pre-migration rows)', () => {
    expect(asReviewPolicy(null)).toBe('auto_send')
    expect(asReviewPolicy(undefined)).toBe('auto_send')
    expect(asReviewPolicy('')).toBe('auto_send')
    expect(asReviewPolicy('hold_everything')).toBe('auto_send')
    expect(asReviewPolicy(42)).toBe('auto_send')
  })

  it('honours an explicit fallback', () => {
    expect(asReviewPolicy(null, 'always_review')).toBe('always_review')
  })

  it('is case-sensitive — uppercase variants are NOT accepted', () => {
    // Defensive: a stale DB row with 'Auto_Send' should NOT be treated
    // as a real policy. Force the fallback so the gate decision is
    // explicit, not accidentally permissive.
    expect(asReviewPolicy('Auto_Send')).toBe('auto_send')
    expect(asReviewPolicy('ALWAYS_REVIEW')).toBe('auto_send')
  })
})

describe('shouldHoldForReview — auto_send', () => {
  it('never holds when policy is auto_send (current behaviour preserved)', () => {
    expect(
      shouldHoldForReview({ policy: 'auto_send', totalIncGst: 99 }).hold,
    ).toBe(false)
    expect(
      shouldHoldForReview({ policy: 'auto_send', totalIncGst: 99999 }).hold,
    ).toBe(false)
  })

  it('defaults missing policy to auto_send (pre-migration rows safe)', () => {
    expect(shouldHoldForReview({ totalIncGst: 1500 }).hold).toBe(false)
    expect(shouldHoldForReview({ policy: null, totalIncGst: 1500 }).hold).toBe(false)
  })

  it('reason string identifies the policy that decided the outcome', () => {
    const r = shouldHoldForReview({ policy: 'auto_send', totalIncGst: 500 })
    expect(r.reason).toBe('tenant_policy_auto_send')
  })
})

describe('shouldHoldForReview — always_review', () => {
  it('always holds regardless of total', () => {
    expect(
      shouldHoldForReview({ policy: 'always_review', totalIncGst: 1 }).hold,
    ).toBe(true)
    expect(
      shouldHoldForReview({ policy: 'always_review', totalIncGst: 999999 }).hold,
    ).toBe(true)
  })

  it('holds even with no total set (defensive)', () => {
    expect(
      shouldHoldForReview({ policy: 'always_review' }).hold,
    ).toBe(true)
  })

  it('reason string identifies always_review', () => {
    const r = shouldHoldForReview({ policy: 'always_review', totalIncGst: 100 })
    expect(r.reason).toBe('tenant_policy_always_review')
  })
})

describe('shouldHoldForReview — review_over_threshold', () => {
  it('holds when total >= threshold', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 500,
      }).hold,
    ).toBe(true)
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 1941,
      }).hold,
    ).toBe(true)
  })

  it('auto-sends when total < threshold', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 499.99,
      }).hold,
    ).toBe(false)
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 99,
      }).hold,
    ).toBe(false)
  })

  it('coerces string numerics from the DB', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: '500',
        totalIncGst: '750',
      }).hold,
    ).toBe(true)
  })

  it('falls back to auto-send when threshold is zero or missing (legacy rows)', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 0,
        totalIncGst: 5000,
      }).hold,
    ).toBe(false)
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: null,
        totalIncGst: 5000,
      }).hold,
    ).toBe(false)
  })

  it('holds defensively when total is unparseable', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: null,
      }).hold,
    ).toBe(true)
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 'NaN',
      }).hold,
    ).toBe(true)
  })

  it('reason string carries the comparison numbers for audit logs', () => {
    const over = shouldHoldForReview({
      policy: 'review_over_threshold',
      threshold: 500,
      totalIncGst: 750,
    })
    expect(over.reason).toBe('total_750_at_or_over_threshold_500')
    const under = shouldHoldForReview({
      policy: 'review_over_threshold',
      threshold: 500,
      totalIncGst: 300,
    })
    expect(under.reason).toBe('total_300_under_threshold_500')
  })
})

describe('shouldHoldForReview — bypass rules', () => {
  it('inspection routes bypass the gate even under always_review', () => {
    const r = shouldHoldForReview({
      policy: 'always_review',
      totalIncGst: 99,
      isInspection: true,
    })
    expect(r.hold).toBe(false)
    expect(r.reason).toBe('inspection_route_bypasses_gate')
  })

  it('inspection routes bypass review_over_threshold too', () => {
    expect(
      shouldHoldForReview({
        policy: 'review_over_threshold',
        threshold: 500,
        totalIncGst: 99,
        isInspection: true,
      }).hold,
    ).toBe(false)
  })

  it('WP9 customer-engaged flow bypasses always_review', () => {
    const r = shouldHoldForReview({
      policy: 'always_review',
      totalIncGst: 1941,
      customerAlreadyEngaged: true,
    })
    expect(r.hold).toBe(false)
    expect(r.reason).toBe('customer_already_chose_product')
  })

  it('threshold wins over WP9 bypass when policy is review_over_threshold', () => {
    // The tradie set $500 as a deliberate risk floor. A picker-driven
    // $1,941 quote still has to wait for approval — picker engagement
    // is not a get-out-of-review card when the threshold rule applies.
    const r = shouldHoldForReview({
      policy: 'review_over_threshold',
      threshold: 500,
      totalIncGst: 1941,
      customerAlreadyEngaged: true,
    })
    expect(r.hold).toBe(true)
    expect(r.reason).toBe('total_1941_at_or_over_threshold_500')
  })

  it('WP9 bypass still auto-sends under-threshold picker quotes', () => {
    // Sanity: when the threshold rule says "send" anyway, the engaged
    // flag is irrelevant — same outcome, threshold reason wins.
    const r = shouldHoldForReview({
      policy: 'review_over_threshold',
      threshold: 500,
      totalIncGst: 200,
      customerAlreadyEngaged: true,
    })
    expect(r.hold).toBe(false)
    expect(r.reason).toBe('total_200_under_threshold_500')
  })

  it('inspection bypass still takes priority over WP9 bypass (both result in send)', () => {
    // Both bypass — verify inspection wins on reason text so audit logs
    // stay predictable.
    const r = shouldHoldForReview({
      policy: 'always_review',
      totalIncGst: 99,
      isInspection: true,
      customerAlreadyEngaged: true,
    })
    expect(r.hold).toBe(false)
    expect(r.reason).toBe('inspection_route_bypasses_gate')
  })
})
