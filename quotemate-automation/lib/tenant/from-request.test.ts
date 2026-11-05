// The resolver's email fallback (lib/tenant/current.ts) may only use an
// address Clerk has verified: an unverified one is anyone's claim.

import { describe, expect, it } from 'vitest'
import { verifiedClerkEmail } from './from-request'

const address = (emailAddress: string, status: string | null) => ({
  emailAddress,
  verification: status ? { status } : null,
})

describe('verifiedClerkEmail', () => {
  it('takes the primary address once Clerk has verified it, lower-cased', () => {
    const primary = address('Owner@Example.com', 'verified')
    expect(verifiedClerkEmail({ primaryEmailAddress: primary, emailAddresses: [primary] })).toBe('owner@example.com')
  })

  it('passes over an unverified address, primary or not, for a verified one', () => {
    const unverified = address('owner@example.com', 'unverified')
    const verified = address('me@example.com', 'verified')
    expect(verifiedClerkEmail({ primaryEmailAddress: unverified, emailAddresses: [unverified, verified] })).toBe('me@example.com')
  })

  it('answers null when Clerk has verified no address', () => {
    expect(verifiedClerkEmail({
      primaryEmailAddress: null,
      emailAddresses: [address('owner@example.com', 'unverified'), address('x@example.com', null)],
    })).toBeNull()
    expect(verifiedClerkEmail({ primaryEmailAddress: null, emailAddresses: [] })).toBeNull()
  })
})
