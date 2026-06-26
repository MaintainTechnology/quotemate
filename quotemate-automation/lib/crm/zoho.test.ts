import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZohoProvider } from '@/lib/crm/zoho'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('ZohoProvider', () => {
  const p = new ZohoProvider()

  beforeEach(() => {
    process.env.ZOHO_CLIENT_ID = 'zcid'
    process.env.ZOHO_CLIENT_SECRET = 'zsecret'
    process.env.ZOHO_REDIRECT_URI = 'https://app/cb'
  })
  afterEach(() => {
    for (const k of [
      'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI',
      'ZOHO_ACCOUNTS_DOMAIN', 'ZOHO_API_DOMAIN',
    ]) delete process.env[k]
    vi.unstubAllGlobals()
  })

  it('builds an offline-access authorize URL on the default DC', () => {
    const url = new URL(p.authorizeUrl('st'))
    expect(url.origin).toBe('https://accounts.zoho.com')
    expect(url.pathname).toBe('/oauth/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('zcid')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('scope')).toBe('ZohoCRM.modules.contacts.READ')
    expect(url.searchParams.get('state')).toBe('st')
  })

  it('honours a region-specific accounts domain', () => {
    process.env.ZOHO_ACCOUNTS_DOMAIN = 'https://accounts.zoho.com.au'
    expect(new URL(p.authorizeUrl('s')).origin).toBe('https://accounts.zoho.com.au')
  })

  it('exchanges an auth code for a token set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    ))
    const t = await p.exchangeCode('code')
    expect(t).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    expect(t.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws when Zoho returns an error field even with 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_code' })))
    await expect(p.exchangeCode('bad')).rejects.toThrow(/zoho token exchange error/)
  })

  it('reuses the refresh token on refresh (Zoho omits a new one)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ access_token: 'at2', expires_in: 3600 })))
    const t = await p.refresh('keep-me')
    expect(t).toMatchObject({ accessToken: 'at2', refreshToken: 'keep-me' })
  })

  it('fetches + maps contacts, stopping when more_records is false', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: '10', Email: 'a@x.com', First_Name: 'A', Last_Name: 'One' },
            { id: '11', Email: null }, // skipped
          ],
          info: { more_records: true },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: '12', Email: 'b@x.com', First_Name: 'B', Last_Name: null }],
          info: { more_records: false },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const contacts = await p.fetchContacts('tok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(contacts).toEqual([
      { externalId: '10', email: 'a@x.com', firstName: 'A', lastName: 'One' },
      { externalId: '12', email: 'b@x.com', firstName: 'B', lastName: null },
    ])
    // uses the Zoho-oauthtoken auth scheme
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('Zoho-oauthtoken tok')
  })

  it('treats HTTP 204 as an empty contact list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    expect(await p.fetchContacts('tok')).toEqual([])
  })
})
