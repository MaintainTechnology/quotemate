// Regression test for the OAuth callback: it must NEVER surface a raw 500.
// Any failure (missing signing secret, bad state, provider error) degrades to a
// 302 redirect back to /dashboard/crm with a crm=error flag.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const { GET } = await import('./route')

function call(qs: string) {
  return GET(new Request(`https://app.example.com/api/tenant/crm/callback?${qs}`))
}

describe('GET /api/tenant/crm/callback — never 500', () => {
  beforeEach(() => {
    delete process.env.OAUTH_STATE_SECRET
    delete process.env.ENCRYPTION_KEY
  })

  it('redirects (not 500) when the signing secret is missing', async () => {
    // With no secret configured, parsing the state throws — this used to 500.
    const res = await call('code=abc&state=sometoken.sig')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('crm=error')
  })

  it('redirects with missing_code_or_state when params are absent', async () => {
    const res = await call('')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('reason=missing_code_or_state')
  })

  it('passes through the provider oauth error reason', async () => {
    const res = await call('error=access_denied')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('reason=access_denied')
  })
})
