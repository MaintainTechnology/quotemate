// Post-review fixes (2026-09-03) for specs/ev-charger-sms-auto-quote.md.
//
// Three defects the independent review found in the first build, each pinned
// here so they cannot come back:
//   R4  — inspection_cause was inferred from `downgradedToInspection`, a flag
//         five unrelated paths set. A genuine three-phase job was therefore
//         labelled 'grounding_failed' and LOST the one sentence that is true
//         of it ("Every site is different") — the exact inverse of the bug the
//         spec exists to fix.
//   R5b — the remembered address was handed to the model that authors the
//         customer-facing SCOPE line.
//   R3.2 DoD — the hold chain (risk flag → review policy → hold, no customer
//         inspection SMS) was never asserted end to end.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// run.ts builds a Supabase client at module scope and vitest injects no env,
// so it is stubbed purely to make the module importable. intakeForModel is
// pure and touches nothing here.
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({}) }) }))

const { intakeForModel } = await import('./run')
const { safetyReviewReasons, shouldHoldForReview } = await import('@/lib/quote/review-policy')

const REPO = path.resolve(__dirname, '..', '..')

describe('R5(b) — the estimator never sees a remembered address', () => {
  const intake = {
    id: 'i1',
    job_type: 'ev_charger',
    suburb: 'Chandler',
    address: null,
    scope: {
      description: 'EV charger install',
      address_source: 'none',
      remembered_address: '652 London Rd',
    },
  }

  it('strips scope.remembered_address from the model payload', () => {
    const forModel = intakeForModel(intake)
    expect(JSON.stringify(forModel)).not.toContain('652 London Rd')
    expect(forModel.scope.remembered_address).toBeUndefined()
    // Everything else survives — this is a redaction, not a rewrite.
    expect(forModel.scope.description).toBe('EV charger install')
    expect(forModel.scope.address_source).toBe('none')
    expect(forModel.suburb).toBe('Chandler')
  })

  it('does not mutate the intake the DB row is built from', () => {
    intakeForModel(intake)
    expect(intake.scope.remembered_address).toBe('652 London Rd')
  })

  it('is a pass-through when there is nothing to strip', () => {
    const plain = { id: 'i2', scope: { description: 'x' } }
    expect(intakeForModel(plain)).toBe(plain)
    expect(intakeForModel({ id: 'i3' })).toEqual({ id: 'i3' })
  })
})

describe('R3.2 DoD — the hold chain, end to end', () => {
  const GROUNDING_FLAG =
    "[grounding] 2 line(s) could not be grounded against this tenant's price rows — quote held for your review before it goes to the customer"

  it('a [grounding] risk flag is recognised as a safety reason', () => {
    expect(safetyReviewReasons([GROUNDING_FLAG])).toContain('grounding_failed')
  })

  it('HOLDS even for a tenant whose policy is auto_send', () => {
    // auto_send is the setting that would otherwise text the customer an
    // unverified number. The safety reason must outrank it.
    const decision = shouldHoldForReview({
      policy: 'auto_send',
      threshold: null,
      totalIncGst: 650,
      isInspection: false,
      riskFlags: [GROUNDING_FLAG],
    })
    expect(decision.hold).toBe(true)
    expect(decision.reason).toContain('grounding_failed')
  })

  it('does not hold a clean auto_send quote — the gate stays narrow', () => {
    const decision = shouldHoldForReview({
      policy: 'auto_send',
      threshold: null,
      totalIncGst: 650,
      isInspection: false,
      riskFlags: ['[billing] over fair-use quote allowance'],
    })
    expect(decision.hold).toBe(false)
  })

  const routeSrc = readFileSync(
    path.join(REPO, 'app', 'api', 'estimate', 'draft', 'route.ts'),
    'utf8',
  )

  it('the route writes [grounding] flags for a HELD draft, not just a downgraded one', () => {
    expect(routeSrc).toMatch(
      /if \(estimation\.downgradedToInspection \|\| estimation\.groundingHold\)/,
    )
  })

  it('a held draft is not an inspection quote, so no inspection SMS can be built', () => {
    // buildInspectionQuoteSms is reached only through buildQuoteSms when
    // needs_inspection is true. R3.2 keeps needs_inspection FALSE, and the
    // tradie branch is chosen by `isInspection`.
    expect(routeSrc).toMatch(/const isInspection = draft\.needs_inspection === true/)
    expect(routeSrc).toMatch(/const tradieBody = isInspection/)
    // And the customer send is skipped whenever the review gate holds.
    expect(routeSrc).toMatch(/if \(reviewDecision\.hold\) \{/)
    expect(routeSrc).toMatch(/held pending tradie approval/)
  })
})

describe('R4 — inspection_cause comes from the estimator, not a coarse flag', () => {
  const routeSrc = readFileSync(
    path.join(REPO, 'app', 'api', 'estimate', 'draft', 'route.ts'),
    'utf8',
  )
  const runSrc = readFileSync(path.join(REPO, 'lib', 'estimate', 'run.ts'), 'utf8')

  it('the route no longer infers the cause from downgradedToInspection', () => {
    expect(routeSrc).toMatch(/estimation\.inspectionCause\s*\n?\s*\?\?/)
    expect(routeSrc).not.toMatch(
      /estimation\.downgradedToInspection\s*\n?\s*\?\s*'grounding_failed'/,
    )
  })

  it("the intake-required path declares itself a SITE decision", () => {
    // The EV three-phase early return. This is the one case where "Every site
    // is different" is the honest sentence, so it must not be relabelled.
    expect(runSrc).toMatch(
      /downgradedToInspection: true, inspectionCause: 'site_conditions'/,
    )
  })

  it('the internal price-authority paths declare themselves grounding failures', () => {
    const matches = runSrc.match(
      /downgradedToInspection: true, inspectionCause: 'grounding_failed'/g,
    )
    expect(matches?.length).toBeGreaterThanOrEqual(2)
  })
})
