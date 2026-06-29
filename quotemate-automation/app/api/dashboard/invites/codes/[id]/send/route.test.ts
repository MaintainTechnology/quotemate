// Route tests for POST /api/dashboard/invites/codes/[id]/send.
// Mocks @supabase/supabase-js (ownership + code lookup) and the two delivery
// libs (@/lib/email/resend, @/lib/sms/dispatch) so the test is deterministic
// and never touches Resend/Twilio. APP_URL is set so the signup deep link is
// stable and assertable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  code: Row | null
  tenant: Row | null
} = { user: null, code: null, tenant: null }

function chain(table: string) {
  const c: any = {
    select: () => c,
    eq: () => c,
    maybeSingle: () =>
      Promise.resolve(
        table === 'onboarding_codes'
          ? { data: state.code, error: null }
          : table === 'tenants'
            ? { data: state.tenant, error: null }
            : { data: null, error: null },
      ),
  }
  return c
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.user }, error: state.user ? null : new Error('no') }),
    },
    from: (t: string) => chain(t),
  }),
}))

vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/sms/dispatch', () => ({ dispatchQuoteMessage: vi.fn() }))

const { POST } = await import('./route')
const { sendEmail } = await import('@/lib/email/resend')
const { dispatchQuoteMessage } = await import('@/lib/sms/dispatch')

function call(body: unknown, id = 'code-1') {
  const req = new Request(`http://localhost/api/dashboard/invites/codes/${id}/send`, {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.code = { id: 'code-1', code: 'MATE2026', tenant_id: 'tenant-1', status: 'active' }
  state.tenant = { id: 'tenant-1', business_name: 'Pilot Sparky' }
  process.env.APP_URL = 'https://app.test'
  ;(sendEmail as any).mockReset()
  ;(sendEmail as any).mockResolvedValue({ ok: true, messageId: 'm1' })
  ;(dispatchQuoteMessage as any).mockReset()
  ;(dispatchQuoteMessage as any).mockResolvedValue({ ok: true, channel: 'sms', sid: 'SM1', status: 'queued' })
})

afterEach(() => {
  delete process.env.APP_URL
  delete process.env.PLATFORM_ADMIN_USER_IDS
})

describe('email channel', () => {
  it('sends the code by email with the signup deep link', async () => {
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, channel: 'email', to: 'tradie@example.com', messageId: 'm1' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tradie@example.com',
        subject: expect.stringContaining('Pilot Sparky'),
        html: expect.stringContaining('MATE2026'),
        text: expect.stringContaining('https://app.test/signup?code=MATE2026'),
      }),
    )
  })

  it('400s on an invalid email address', async () => {
    const res = await call({ channel: 'email', to: 'not-an-email' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_recipient')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('503s when email is not configured', async () => {
    ;(sendEmail as any).mockResolvedValue({ ok: false, code: 'not_configured', reason: 'no key' })
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('send_failed')
  })

  it('502s when the provider rejects the send', async () => {
    ;(sendEmail as any).mockResolvedValue({ ok: false, code: 'http_422', reason: 'bad' })
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(502)
  })
})

describe('sms channel', () => {
  it('sends the code by SMS to a normalised AU mobile', async () => {
    const res = await call({ channel: 'sms', to: '0400 000 000' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, channel: 'sms', to: '+61400000000', sid: 'SM1' })
    expect(dispatchQuoteMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+61400000000',
        text: expect.stringContaining('MATE2026'),
      }),
    )
    const arg = (dispatchQuoteMessage as any).mock.calls[0][0]
    expect(arg.text).toContain('https://app.test/signup?code=MATE2026')
  })

  it('400s on a number that is not a valid AU mobile', async () => {
    const res = await call({ channel: 'sms', to: '12345' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_recipient')
    expect(dispatchQuoteMessage).not.toHaveBeenCalled()
  })

  it('502s when dispatch fails', async () => {
    ;(dispatchQuoteMessage as any).mockResolvedValue({
      ok: false,
      smsAttempt: { code: '21610', reason: 'blocked' },
      smsAttempts: 1,
    })
    const res = await call({ channel: 'sms', to: '0400000000' })
    expect(res.status).toBe(502)
  })
})

describe('ownership + status guards', () => {
  it('422s for a revoked code', async () => {
    state.code = { ...state.code!, status: 'revoked' }
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('code_revoked')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('403s when the caller does not own the code tenant', async () => {
    state.tenant = { id: 'other-tenant', business_name: 'Someone Else' }
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(403)
  })

  it('403s on a platform-wide code for a non platform-admin', async () => {
    state.code = { ...state.code!, tenant_id: null }
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(403)
  })

  it('sends a platform-wide code as "QuoteMax" for a platform admin', async () => {
    state.code = { ...state.code!, tenant_id: null }
    process.env.PLATFORM_ADMIN_USER_IDS = 'user-1'
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Your QuoteMax invite code from QuoteMax' }),
    )
  })

  it('404s when the code does not exist', async () => {
    state.code = null
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(404)
  })

  it('401s when unauthenticated', async () => {
    state.user = null
    const res = await call({ channel: 'email', to: 'tradie@example.com' })
    expect(res.status).toBe(401)
  })

  it('400s on an unknown channel', async () => {
    const res = await call({ channel: 'carrier-pigeon', to: 'tradie@example.com' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })
})
