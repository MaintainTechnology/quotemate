// POST /api/auth/signup — the duplicate-email branch.
//
// The auth user is created here; the tenant only at /api/onboard/activate.
// Anyone who abandoned the wizard in between is an auth user with NO tenant,
// and a blanket 409 locks them out of their own email forever (the
// jon@pepco.com.au report). Such a signup must be able to RESUME — but only on
// proof of ownership, or "already exists" becomes an account-takeover hole.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    createUserError: null as unknown,
    signInUser: null as { id: string } | null,
    signInError: null as unknown,
    tenant: null as unknown,
    tenantError: null as unknown,
    signInCalls: [] as unknown[],
  }

  const createClient = (_url: string, key: string) => ({
    auth: {
      admin: {
        createUser: async () =>
          state.createUserError
            ? { data: { user: null }, error: state.createUserError }
            : { data: { user: { id: 'new-user', email: 'a@b.com' } }, error: null },
      },
      signInWithPassword: async (creds: unknown) => {
        state.signInCalls.push({ key, creds })
        return state.signInError
          ? { data: { user: null }, error: state.signInError }
          : { data: { user: state.signInUser }, error: null }
      },
    },
    from: () => {
      const b: Record<string, unknown> = {}
      for (const op of ['select', 'or']) b[op] = () => b
      b.maybeSingle = async () => ({ data: state.tenant, error: state.tenantError })
      return b
    },
  })

  return { state, createClient }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

const { POST } = await import('./route')

const body = (over: Record<string, unknown> = {}) => ({
  email: 'Jon@Pepco.com.AU',
  password: 'Sup3rSecret!',
  business_name: 'Pepco Electrical',
  owner_first_name: 'Jon',
  owner_mobile: '+61481613464',
  ...over,
})

const post = (b: unknown) =>
  POST(new Request('http://t/api/auth/signup', { method: 'POST', body: JSON.stringify(b) }))

const DUPLICATE = { message: 'A user with this email address has already been registered', code: 'email_exists' }

beforeEach(() => {
  h.state.createUserError = null
  h.state.signInUser = null
  h.state.signInError = null
  h.state.tenant = null
  h.state.tenantError = null
  h.state.signInCalls = []
})

describe('POST /api/auth/signup — duplicate email', () => {
  it('creates the user normally when the email is free', async () => {
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, user_id: 'new-user' })
  })

  it('RESUMES an abandoned signup: auth user exists, no tenant, password matches', async () => {
    h.state.createUserError = DUPLICATE
    h.state.signInUser = { id: 'orphan-user' } // password authenticates
    h.state.tenant = null // …but nothing was ever activated

    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      user_id: 'orphan-user',
      resumed: true,
    })
  })

  it('does NOT resume when the password is wrong (account-takeover guard)', async () => {
    h.state.createUserError = DUPLICATE
    h.state.signInError = { message: 'Invalid login credentials' }
    h.state.tenant = null // orphan, but ownership unproven

    const res = await post(body())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ duplicate: true })
  })

  it('does NOT resume a real activated account, even with the right password', async () => {
    h.state.createUserError = DUPLICATE
    h.state.signInUser = { id: 'real-user' }
    h.state.tenant = { id: 'tenant-1' } // already onboarded → sign in, don't re-onboard

    const res = await post(body())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ duplicate: true })
  })

  it('fails closed to 409 when the tenant lookup errors', async () => {
    h.state.createUserError = DUPLICATE
    h.state.signInUser = { id: 'orphan-user' }
    h.state.tenantError = { message: 'db down' }

    const res = await post(body())
    expect(res.status).toBe(409)
  })

  it('checks the password with the anon key, never the service-role key', async () => {
    h.state.createUserError = DUPLICATE
    h.state.signInUser = { id: 'orphan-user' }
    await post(body())

    expect(h.state.signInCalls).toHaveLength(1)
    expect(h.state.signInCalls[0]).toMatchObject({
      key: 'anon',
      creds: { email: 'jon@pepco.com.au' }, // normalised by the Zod schema
    })
  })
})
