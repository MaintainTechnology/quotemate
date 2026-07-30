import { describe, it, expect } from 'vitest'
import { explainFailure, suburbFromAddress } from './JobQuoteForm'

// ════════════════════════════════════════════════════════════════════
// The two pure helpers behind the form's failure handling. Both exist because
// the first cut got them wrong in ways a tradie feels: an unreadable error after
// a two-minute wait, and a picked address that then failed the completeness
// check because Suburb stayed empty.
// ════════════════════════════════════════════════════════════════════

describe('explainFailure', () => {
  it('prefers field-level validation issues verbatim', () => {
    expect(explainFailure(400, { error: 'invalid_body', issues: ['address is required'] })).toBe(
      'address is required',
    )
  })

  it('maps every auth/entitlement shape the guard returns', () => {
    expect(explainFailure(401, { error: 'unauthorized' })).toMatch(/session expired/i)
    expect(explainFailure(404, { error: 'no_tenant' })).toMatch(/no tradie account/i)
    expect(explainFailure(403, { error: 'feature_not_enabled' })).toMatch(/isn't enabled/i)
    expect(explainFailure(502, { error: 'not_entitled', reason: 'quota' })).toMatch(/not enabled on your plan.*quota/i)
  })

  it('tells the tradie to check the Quotes tab when an intake already exists', () => {
    // The dangerous case: retrying a draft that half-succeeded mints a SECOND
    // intake, quote, Stripe session set and tradie SMS.
    const withIntake = explainFailure(502, { error: 'draft_failed', intakeId: 'abc' })
    expect(withIntake).toMatch(/check the Quotes tab/i)
    // No intake id ⇒ nothing was saved, so retrying is safe and we say so.
    expect(explainFailure(502, { error: 'draft_failed' })).toMatch(/try again/i)
    expect(explainFailure(502, { error: 'draft_failed' })).not.toMatch(/check the Quotes tab/i)
  })

  it('treats an upstream blip as retryable', () => {
    expect(explainFailure(500, { error: 'pipeline_failed' })).toMatch(/temporary upstream/i)
  })

  it('handles a gateway timeout with an empty body', () => {
    // res.json() on an HTML 504 body throws; the caller passes {} and this is
    // what the tradie must see instead of "Unexpected token '<'".
    expect(explainFailure(504, {})).toMatch(/timed out/i)
    expect(explainFailure(504, {})).toMatch(/check the Quotes tab/i)
  })

  it('never renders a bare internal slug', () => {
    const msg = explainFailure(500, { error: 'some_new_thing_nobody_mapped' })
    expect(msg).not.toContain('some_new_thing_nobody_mapped')
    expect(msg).toMatch(/could not draft the quote/i)
  })
})

describe('suburbFromAddress', () => {
  it('pulls the suburb out of a Geoscape line', () => {
    expect(suburbFromAddress('12 Smith St, Penrith NSW 2750', 'NSW', '2750')).toBe('Penrith')
  })

  it('strips a trailing state and postcode even when not passed separately', () => {
    expect(suburbFromAddress('12 Smith St, Penrith NSW 2750')).toBe('Penrith')
    expect(suburbFromAddress('9 Rose Ave, Bondi Beach NSW 2026')).toBe('Bondi Beach')
  })

  it('handles a three-part address', () => {
    expect(suburbFromAddress('Unit 4, 12 Smith St, Penrith NSW 2750', 'NSW', '2750')).toBe('Penrith')
  })

  it('returns null rather than guessing', () => {
    // One part ⇒ no comma ⇒ nothing to take. Must not overwrite the tradie's box.
    expect(suburbFromAddress('12 Smith St')).toBeNull()
    expect(suburbFromAddress('')).toBeNull()
    // Nothing left after stripping state + postcode.
    expect(suburbFromAddress('12 Smith St, NSW 2750', 'NSW', '2750')).toBeNull()
  })
})
