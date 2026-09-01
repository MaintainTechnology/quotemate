import { describe, expect, it } from 'vitest'
import { deriveActivationOwnership } from './activation-identity'

describe('deriveActivationOwnership', () => {
  it('derives Clerk ownership from the verified bearer when the client omits ids', () => {
    expect(
      deriveActivationOwnership(
        { provider: 'clerk', userId: 'user_authenticated', email: null },
        {},
      ),
    ).toEqual({ ok: true, ownerUserId: null, clerkUserId: 'user_authenticated' })
  })

  it('accepts a matching legacy client assertion but still returns the verified subject', () => {
    expect(
      deriveActivationOwnership(
        { provider: 'clerk', userId: 'user_authenticated', email: null },
        { clerk_user_id: 'user_authenticated' },
      ),
    ).toEqual({ ok: true, ownerUserId: null, clerkUserId: 'user_authenticated' })
  })

  it('rejects a mismatched Clerk id instead of redirecting ownership', () => {
    expect(
      deriveActivationOwnership(
        { provider: 'clerk', userId: 'user_authenticated', email: null },
        { clerk_user_id: 'user_victim' },
      ),
    ).toMatchObject({ ok: false, field: 'clerk_user_id' })
  })

  it('rejects a caller-supplied legacy id on a Clerk activation', () => {
    expect(
      deriveActivationOwnership(
        { provider: 'clerk', userId: 'user_authenticated', email: null },
        { owner_user_id: '11111111-1111-4111-8111-111111111111' },
      ),
    ).toMatchObject({ ok: false, field: 'owner_user_id' })
  })

  it('derives legacy ownership from the verified Supabase bearer', () => {
    expect(
      deriveActivationOwnership(
        {
          provider: 'supabase',
          userId: '11111111-1111-4111-8111-111111111111',
          email: 'owner@example.com',
        },
        {
          owner_user_id: '11111111-1111-4111-8111-111111111111',
          owner_email: 'OWNER@example.com',
        },
      ),
    ).toEqual({
      ok: true,
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      clerkUserId: null,
    })
  })

  it('rejects an email assertion that conflicts with a verified token claim', () => {
    expect(
      deriveActivationOwnership(
        {
          provider: 'supabase',
          userId: '11111111-1111-4111-8111-111111111111',
          email: 'owner@example.com',
        },
        { owner_email: 'victim@example.com' },
      ),
    ).toMatchObject({ ok: false, field: 'owner_email' })
  })
})
