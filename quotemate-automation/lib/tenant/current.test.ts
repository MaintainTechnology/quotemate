// The dual-auth resolver: given a request's Bearer token, figure out which
// identity provider minted it (Clerk vs the legacy Supabase session), resolve
// the caller, and load their tenant by the right key (clerk_user_id for Clerk,
// owner_user_id for Supabase). The Supabase branch preserves 100% of existing
// behaviour, so any route wired to this keeps working for logged-in Supabase
// users — that is the "no lock-out" guarantee.

import { describe, it, expect, vi } from 'vitest'
import {
  parseBearer,
  decodeJwtPayload,
  providerForToken,
  identityFromRequest,
  tenantFromRequest,
} from './current'

// Build a structurally-valid JWT (header.payload.sig) with an arbitrary payload.
function mkJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}

const SUPA_TOKEN = mkJwt({ iss: 'https://bobvihqwhtcbxneelfns.supabase.co/auth/v1', sub: 'supa-uuid' })
const CLERK_DEV_TOKEN = mkJwt({ iss: 'https://touched-mutt-12.clerk.accounts.dev', sub: 'user_abc' })
const CLERK_PROD_TOKEN = mkJwt({ iss: 'https://clerk.quotemax.app', sub: 'user_xyz' })

function reqWith(auth?: string): Request {
  return new Request('https://x.test/api/tenant/me', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('parseBearer', () => {
  it('extracts the token from a Bearer header (case-insensitive)', () => {
    expect(parseBearer(reqWith('Bearer abc.def.ghi'))).toBe('abc.def.ghi')
    expect(parseBearer(reqWith('bearer TOKEN'))).toBe('TOKEN')
  })
  it('returns null without a Bearer header', () => {
    expect(parseBearer(reqWith())).toBeNull()
    expect(parseBearer(reqWith('Basic zzz'))).toBeNull()
    expect(parseBearer(reqWith('Bearer '))).toBeNull()
  })
})

describe('decodeJwtPayload', () => {
  it('decodes the payload of a JWT without verifying', () => {
    expect(decodeJwtPayload(SUPA_TOKEN)).toMatchObject({ sub: 'supa-uuid' })
  })
  it('returns null for non-JWT input', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.b')).toBeNull()
  })
})

describe('providerForToken', () => {
  it('classifies Supabase issuers', () => {
    expect(providerForToken(SUPA_TOKEN)).toBe('supabase')
  })
  it('classifies Clerk issuers (dev instance + custom domain)', () => {
    expect(providerForToken(CLERK_DEV_TOKEN)).toBe('clerk')
    expect(providerForToken(CLERK_PROD_TOKEN)).toBe('clerk')
  })
  it('returns null for an unclassifiable / issuer-less token', () => {
    expect(providerForToken(mkJwt({ sub: 'x' }))).toBeNull()
    expect(providerForToken('garbage')).toBeNull()
  })
})

describe('identityFromRequest', () => {
  const supaUser = { id: 'supa-uuid', email: 'Tradie@Example.com' }
  function deps(overrides: Partial<{ getUser: unknown; verifyClerk: unknown }> = {}) {
    return {
      supabase: {
        auth: { getUser: overrides.getUser ?? vi.fn(async () => ({ data: { user: supaUser }, error: null })) },
      } as never,
      verifyClerk: (overrides.verifyClerk ?? vi.fn(async () => ({ sub: 'user_abc', email: null }))) as never,
    }
  }

  it('resolves a Clerk token via the Clerk verifier (never calls Supabase)', async () => {
    const getUser = vi.fn()
    const id = await identityFromRequest(reqWith(`Bearer ${CLERK_DEV_TOKEN}`), deps({ getUser }))
    expect(id).toEqual({ provider: 'clerk', userId: 'user_abc', email: null })
    expect(getUser).not.toHaveBeenCalled()
  })

  it('returns null when the Clerk token fails verification', async () => {
    const id = await identityFromRequest(
      reqWith(`Bearer ${CLERK_DEV_TOKEN}`),
      deps({ verifyClerk: vi.fn(async () => null) }),
    )
    expect(id).toBeNull()
  })

  it('resolves a Supabase token via getUser (legacy path unchanged)', async () => {
    const id = await identityFromRequest(reqWith(`Bearer ${SUPA_TOKEN}`), deps())
    expect(id).toEqual({ provider: 'supabase', userId: 'supa-uuid', email: 'Tradie@Example.com' })
  })

  it('falls back to the Supabase verifier for an unclassifiable token (legacy default)', async () => {
    const getUser = vi.fn(async () => ({ data: { user: supaUser }, error: null }))
    const id = await identityFromRequest(reqWith(`Bearer ${mkJwt({ sub: 'x' })}`), deps({ getUser }))
    expect(id?.provider).toBe('supabase')
    expect(getUser).toHaveBeenCalledOnce()
  })

  it('returns null when Supabase rejects the token', async () => {
    const id = await identityFromRequest(
      reqWith(`Bearer ${SUPA_TOKEN}`),
      deps({ getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'bad jwt' } })) }),
    )
    expect(id).toBeNull()
  })

  it('returns null with no Authorization header', async () => {
    expect(await identityFromRequest(reqWith(), deps())).toBeNull()
  })
})

describe('tenantFromRequest', () => {
  // A fake Supabase that records which column a tenant lookup filtered on.
  function fakeSupabase(tenantRow: Record<string, unknown> | null, supaUser = { id: 'supa-uuid', email: null }) {
    const calls: { column: string; value: unknown }[] = []
    return {
      calls,
      client: {
        auth: { getUser: vi.fn(async () => ({ data: { user: supaUser }, error: null })) },
        from() {
          return {
            select() {
              return {
                eq(column: string, value: unknown) {
                  calls.push({ column, value })
                  return { maybeSingle: async () => ({ data: tenantRow, error: null }) }
                },
              }
            },
          }
        },
      } as never,
    }
  }

  it('looks up a Clerk caller by clerk_user_id', async () => {
    const fake = fakeSupabase({ id: 'tenant-1' })
    const res = await tenantFromRequest(reqWith(`Bearer ${CLERK_DEV_TOKEN}`), {
      supabase: fake.client,
      verifyClerk: vi.fn(async () => ({ sub: 'user_abc', email: null })),
    })
    expect(res?.identity.provider).toBe('clerk')
    expect(res?.tenant).toEqual({ id: 'tenant-1' })
    expect(fake.calls).toEqual([{ column: 'clerk_user_id', value: 'user_abc' }])
  })

  it('looks up a Supabase caller by owner_user_id (unchanged behaviour)', async () => {
    const fake = fakeSupabase({ id: 'tenant-2' }, { id: 'supa-uuid', email: null })
    const res = await tenantFromRequest(reqWith(`Bearer ${SUPA_TOKEN}`), {
      supabase: fake.client,
      verifyClerk: vi.fn(async () => null),
    })
    expect(res?.identity.provider).toBe('supabase')
    expect(fake.calls).toEqual([{ column: 'owner_user_id', value: 'supa-uuid' }])
  })

  it('returns null when authentication fails', async () => {
    const fake = fakeSupabase(null)
    const res = await tenantFromRequest(reqWith(), {
      supabase: fake.client,
      verifyClerk: vi.fn(async () => null),
    })
    expect(res).toBeNull()
    expect(fake.calls).toEqual([])
  })
})
