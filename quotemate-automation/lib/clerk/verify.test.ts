// Guards the runtime-vs-types mismatch that once 401'd every Clerk user: the
// installed @clerk/backend returns the claims payload directly, not a
// { data, errors } wrapper. extractClerkClaims must handle BOTH.

import { describe, it, expect } from 'vitest'
import { extractClerkClaims } from './verify'

describe('extractClerkClaims', () => {
  it('reads sub from the claims-payload-directly shape (current runtime)', () => {
    const res = { sub: 'user_abc', iss: 'https://x.clerk.accounts.dev', azp: 'http://localhost:3000' }
    expect(extractClerkClaims(res)).toEqual({ sub: 'user_abc', email: null })
  })

  it('reads sub from the { data } wrapper shape (older typings)', () => {
    expect(extractClerkClaims({ data: { sub: 'user_xyz' } })).toEqual({ sub: 'user_xyz', email: null })
  })

  it('surfaces an email claim when present', () => {
    expect(extractClerkClaims({ sub: 'user_1', email: 'a@b.com' })).toEqual({ sub: 'user_1', email: 'a@b.com' })
  })

  it('returns null on an errors wrapper', () => {
    expect(extractClerkClaims({ errors: [{ message: 'bad' }] })).toBeNull()
  })

  it('returns null when there is no sub', () => {
    expect(extractClerkClaims({ iss: 'x' })).toBeNull()
    expect(extractClerkClaims(null)).toBeNull()
    expect(extractClerkClaims('nope')).toBeNull()
  })
})
