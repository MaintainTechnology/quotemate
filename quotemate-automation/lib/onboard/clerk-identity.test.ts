// Spec: specs/clerk-signup-parity.md R1 — the Clerk equivalent of the Supabase
// session backfill at app/onboard/page.tsx:322-334.

import { describe, it, expect } from 'vitest'
import { identityFromClerkUser } from './clerk-identity'

const FULL = {
  firstName: 'Jo',
  primaryEmailAddress: { emailAddress: 'jo@sparky.com.au' },
  unsafeMetadata: { business_name: 'Jo Sparky Pty Ltd', owner_mobile: '+61412345678' },
}

describe('identityFromClerkUser', () => {
  it('maps a fully populated Clerk user to the wizard patch', () => {
    expect(identityFromClerkUser(FULL)).toEqual({
      business_name: 'Jo Sparky Pty Ltd',
      owner_first_name: 'Jo',
      owner_email: 'jo@sparky.com.au',
      owner_mobile: '+61412345678',
    })
  })

  it('omits keys whose source is absent rather than emitting empty strings', () => {
    // An empty-string value would overwrite a good URL param via `prev.x || patch.x`,
    // so absent MUST mean absent.
    const patch = identityFromClerkUser({
      firstName: 'Jo',
      primaryEmailAddress: { emailAddress: 'jo@sparky.com.au' },
    })
    expect(patch).toEqual({ owner_first_name: 'Jo', owner_email: 'jo@sparky.com.au' })
    expect('business_name' in patch).toBe(false)
    expect('owner_mobile' in patch).toBe(false)
  })

  it('normalises a spaced local mobile to E.164 (the activate schema is strict)', () => {
    const patch = identityFromClerkUser({
      ...FULL,
      unsafeMetadata: { business_name: 'X', owner_mobile: '04 1234 5678' },
    })
    expect(patch.owner_mobile).toBe('+61412345678')
  })

  it('keeps an unparseable mobile raw so the tradie can see and fix it', () => {
    const patch = identityFromClerkUser({
      ...FULL,
      unsafeMetadata: { owner_mobile: '12345' },
    })
    expect(patch.owner_mobile).toBe('12345')
  })

  it('ignores non-string metadata instead of coercing it', () => {
    const patch = identityFromClerkUser({
      ...FULL,
      unsafeMetadata: { business_name: 42, owner_mobile: null },
    })
    expect('business_name' in patch).toBe(false)
    expect('owner_mobile' in patch).toBe(false)
  })

  it('trims whitespace-only values away', () => {
    const patch = identityFromClerkUser({
      firstName: '   ',
      primaryEmailAddress: { emailAddress: 'jo@sparky.com.au' },
      unsafeMetadata: { business_name: '  ' },
    })
    expect(patch).toEqual({ owner_email: 'jo@sparky.com.au' })
  })

  it('returns an empty patch for a null/undefined user (Clerk not hydrated yet)', () => {
    expect(identityFromClerkUser(null)).toEqual({})
    expect(identityFromClerkUser(undefined)).toEqual({})
  })
})
