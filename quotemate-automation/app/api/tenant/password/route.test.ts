// Route tests for POST /api/tenant/password.
//
// Mocks @supabase/supabase-js BEFORE importing the route (same pattern as
// the other /api/tenant route tests). A single shared `state` drives the
// three auth surfaces the route touches: getUser (bearer validation),
// signInWithPassword (current-password proof), and admin.updateUserById
// (the write).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state: {
  user: { id: string; email?: string } | null
  signInError: { message: string } | null
  updateError: { message: string } | null
  updatedCalls: { id: string; attrs: Record<string, unknown> }[]
} = { user: null, signInError: null, updateError: null, updatedCalls: [] }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: state.user },
          error: state.user ? null : new Error('no user'),
        }),
      signInWithPassword: () =>
        Promise.resolve({ data: {}, error: state.signInError }),
      admin: {
        updateUserById: (id: string, attrs: Record<string, unknown>) => {
          state.updatedCalls.push({ id, attrs })
          return Promise.resolve({ data: {}, error: state.updateError })
        },
      },
    },
  }),
}))

const { POST } = await import('./route')

function postReq(body: unknown, withAuth = true) {
  return new Request('http://localhost/api/tenant/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(withAuth ? { Authorization: 'Bearer test-token' } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1', email: 'tradie@example.com.au' }
  state.signInError = null
  state.updateError = null
  state.updatedCalls = []
})

describe('POST /api/tenant/password', () => {
  it('401s without a bearer token', async () => {
    const res = await POST(postReq({ current_password: 'oldpass12', new_password: 'newpass12' }, false))
    expect(res.status).toBe(401)
  })

  it('401s when the token does not resolve to a user', async () => {
    state.user = null
    const res = await POST(postReq({ current_password: 'oldpass12', new_password: 'newpass12' }))
    expect(res.status).toBe(401)
  })

  it('400s when the new password is too short', async () => {
    const res = await POST(postReq({ current_password: 'oldpass12', new_password: 'short' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/at least 8/i)
  })

  it('400s when the new password equals the current password', async () => {
    const res = await POST(postReq({ current_password: 'samepass12', new_password: 'samepass12' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/different/i)
    expect(state.updatedCalls).toHaveLength(0)
  })

  it('400s when the current password is incorrect', async () => {
    state.signInError = { message: 'Invalid login credentials' }
    const res = await POST(postReq({ current_password: 'wrongpass12', new_password: 'newpass12' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/current password is incorrect/i)
    expect(state.updatedCalls).toHaveLength(0)
  })

  it('500s when the password update fails', async () => {
    state.updateError = { message: 'db down' }
    const res = await POST(postReq({ current_password: 'oldpass12', new_password: 'newpass12' }))
    expect(res.status).toBe(500)
  })

  it('updates the password on the happy path', async () => {
    const res = await POST(postReq({ current_password: 'oldpass12', new_password: 'newpass12' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(state.updatedCalls).toHaveLength(1)
    expect(state.updatedCalls[0]).toMatchObject({
      id: 'user-1',
      attrs: { password: 'newpass12' },
    })
  })
})
