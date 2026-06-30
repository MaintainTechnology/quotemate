import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubspotProvider } from '@/lib/crm/hubspot'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('HubspotProvider', () => {
  const p = new HubspotProvider()

  beforeEach(() => {
    process.env.HUBSPOT_CLIENT_ID = 'cid'
    process.env.HUBSPOT_CLIENT_SECRET = 'secret'
    process.env.HUBSPOT_REDIRECT_URI = 'https://app/cb'
    process.env.OAUTH_STATE_SECRET = 'pkce-secret'
  })
  afterEach(() => {
    delete process.env.HUBSPOT_CLIENT_ID
    delete process.env.HUBSPOT_CLIENT_SECRET
    delete process.env.HUBSPOT_REDIRECT_URI
    delete process.env.OAUTH_STATE_SECRET
    vi.unstubAllGlobals()
  })

  it('builds an authorize URL with client_id, redirect_uri, scope, state + PKCE', () => {
    const url = new URL(p.authorizeUrl('state-123'))
    expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/cb')
    expect(url.searchParams.get('scope')).toContain('crm.objects.contacts.read')
    expect(url.searchParams.get('state')).toBe('state-123')
    // PKCE (required by HubSpot): a code_challenge + S256 method must be present.
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('exchanges an auth code for a token set, sending the PKCE code_verifier', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 1800 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const t = await p.exchangeCode('code-1', 'verifier-xyz')
    expect(t.accessToken).toBe('at')
    expect(t.refreshToken).toBe('rt')
    expect(t.expiresAt).toBeGreaterThan(Date.now())
    // posts to the v3 token endpoint with the verifier in the form body
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.hubapi.com/oauth/v3/token')
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('code_verifier=verifier-xyz')
  })

  it('keeps the existing refresh token when refresh response omits one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ access_token: 'at2', expires_in: 1800 }),
    ))
    const t = await p.refresh('original-rt')
    expect(t.accessToken).toBe('at2')
    expect(t.refreshToken).toBe('original-rt')
  })

  it('throws on a non-OK token exchange', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })))
    await expect(p.exchangeCode('x')).rejects.toThrow(/hubspot token exchange failed/)
  })

  it('fetches + maps contacts, paginating until paging.next is absent', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { id: '1', properties: { email: 'a@x.com', firstname: 'A', lastname: 'One' } },
            { id: '2', properties: { email: null } }, // skipped (no email)
          ],
          paging: { next: { after: '2' } },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: '3', properties: { email: 'b@x.com', firstname: 'B' } }],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const contacts = await p.fetchContacts('access-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(contacts).toEqual([
      { externalId: '1', email: 'a@x.com', firstName: 'A', lastName: 'One' },
      { externalId: '3', email: 'b@x.com', firstName: 'B', lastName: null },
    ])
    // second page request carries the `after` cursor
    expect(String(fetchMock.mock.calls[1][0])).toContain('after=2')
  })

  it('isConfigured reflects env presence', () => {
    expect(p.isConfigured()).toBe(true)
    delete process.env.HUBSPOT_CLIENT_SECRET
    expect(p.isConfigured()).toBe(false)
  })
})
