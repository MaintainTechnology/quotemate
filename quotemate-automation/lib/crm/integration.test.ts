// End-to-end integration test for the CRM email-blast feature.
//
// Wires the REAL modules together (oauth-state, the provider, crypto, contact
// prep, recipient selection, email rendering, unsubscribe tokens, QR) and only
// mocks the external provider HTTP at the network boundary. It simulates two
// DIFFERENT tradies — one on HubSpot, one on Zoho — and asserts the full flow
// works for each AND that they stay isolated. This is the "works for other
// tradies' CRM" proof: nothing is hard-coded to one tenant or one provider.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProvider } from '@/lib/crm/registry'
import { makeOAuthState, parseOAuthState } from '@/lib/crm/oauth-state'
import { decryptSecret, encryptSecret } from '@/lib/crypto/encrypt'
import { prepareContactRows } from '@/lib/crm/sync'
import { selectRecipients } from '@/lib/email/recipients'
import { renderAnnouncementEmail, type AnnouncementTenant } from '@/lib/email/announcement'
import { tenantIntakeUrl, unsubscribeUrl } from '@/lib/email/links'
import { makeUnsubscribeToken, parseUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { generateQrDataUrl } from '@/lib/qr/generate'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

// Route a mocked fetch by URL substring so one mock serves both providers.
function fetchRouter(routes: Array<[string, () => Response]>) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    for (const [needle, handler] of routes) if (u.includes(needle)) return handler()
    throw new Error(`unexpected fetch in test: ${u}`)
  })
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('hex')
  process.env.OAUTH_STATE_SECRET = 'state-secret'
  process.env.UNSUBSCRIBE_SECRET = 'unsub-secret'
  process.env.APP_URL = 'https://quote-mate-rho.vercel.app'
  process.env.HUBSPOT_CLIENT_ID = 'hs-client-id'
  process.env.HUBSPOT_CLIENT_SECRET = 'hs-secret'
  process.env.HUBSPOT_REDIRECT_URI = 'https://quote-mate-rho.vercel.app/api/tenant/crm/callback'
  process.env.ZOHO_CLIENT_ID = '1000.ZOHOTESTID'
  process.env.ZOHO_CLIENT_SECRET = 'zoho-secret'
  process.env.ZOHO_REDIRECT_URI = 'https://quote-mate-rho.vercel.app/api/tenant/crm/callback'
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of [
    'ENCRYPTION_KEY', 'OAUTH_STATE_SECRET', 'UNSUBSCRIBE_SECRET', 'APP_URL',
    'HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'HUBSPOT_REDIRECT_URI',
    'ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REDIRECT_URI',
  ]) delete process.env[k]
})

/**
 * Run the full "a tradie connects their CRM and sends the announcement" flow
 * using only real module code. Returns the artifacts so the test can assert.
 */
async function runTradieFlow(opts: {
  tenantId: string
  provider: 'hubspot' | 'zoho'
  tenant: AnnouncementTenant
}) {
  // 1. Connect: the dashboard mints a signed state and sends the tradie to the
  //    provider; the callback recovers exactly which tenant connected.
  const state = makeOAuthState(opts.tenantId, opts.provider)
  const parsed = parseOAuthState(state)
  expect(parsed).toEqual({ tenantId: opts.tenantId, provider: opts.provider })

  const impl = getProvider(opts.provider)

  // 2. Authorize URL is built with this platform's (shared) client id and the
  //    tenant-bound state.
  const authUrl = new URL(impl.authorizeUrl(state))
  expect(authUrl.searchParams.get('state')).toBe(state)
  expect(authUrl.searchParams.get('redirect_uri')).toBe(
    'https://quote-mate-rho.vercel.app/api/tenant/crm/callback',
  )

  // 3. Token exchange (provider HTTP mocked) → encrypt at rest → decrypt back.
  const tokens = await impl.exchangeCode(`auth-code-${opts.tenantId}`)
  expect(tokens.accessToken).toBeTruthy()
  const stored = encryptSecret(tokens.accessToken)
  expect(stored).not.toContain(tokens.accessToken)
  expect(decryptSecret(stored)).toBe(tokens.accessToken)

  // 4. Import contacts (provider HTTP mocked) → normalise + dedup, scoped to
  //    THIS tenant.
  const contacts = await impl.fetchContacts(decryptSecret(stored))
  const rows = prepareContactRows(opts.tenantId, `conn-${opts.tenantId}`, contacts)
  expect(rows.every((r) => r.tenant_id === opts.tenantId)).toBe(true)

  // 5. Select recipients + render the announcement with THIS tradie's branding,
  //    a per-recipient unsubscribe token, and a QR pointing at their intake page.
  const selection = selectRecipients({
    contacts: rows.map((r) => ({ email: r.email, first_name: r.first_name })),
    unsubscribed: [],
    alreadySent: [],
    mode: 'all',
  })
  const intakeUrl = tenantIntakeUrl(opts.tenantId)
  const qrDataUrl = await generateQrDataUrl(intakeUrl)
  const first = selection.recipients[0]
  const unsubToken = makeUnsubscribeToken(opts.tenantId, first.email)
  const email = renderAnnouncementEmail({
    tenant: opts.tenant,
    recipientFirstName: first.first_name,
    intakeUrl,
    qrDataUrl,
    unsubscribeUrl: unsubscribeUrl(unsubToken),
  })

  return { state, rows, selection, intakeUrl, email, unsubToken, decryptedToken: decryptSecret(stored) }
}

describe('CRM email-blast — end-to-end, multi-tradie', () => {
  it('Tradie A (electrical, HubSpot): full connect → import → announce', async () => {
    vi.stubGlobal('fetch', fetchRouter([
      ['api.hubapi.com/oauth/v3/token', () =>
        json({ access_token: 'hs-access-A', refresh_token: 'hs-refresh-A', expires_in: 1800 })],
      ['api.hubapi.com/crm/v3/objects/contacts', () =>
        json({ results: [
          { id: '1', properties: { email: 'jo@site.com', firstname: 'Jo', lastname: 'Bloggs' } },
          { id: '2', properties: { email: 'JO@SITE.COM', firstname: 'dupe' } }, // case-dup
          { id: '3', properties: { email: 'no-email-here' } }, // invalid → dropped
        ] })],
    ]))

    const tenant: AnnouncementTenant = {
      business_name: 'Atomic Electrical',
      business_address: '5 Volt St, Sydney NSW 2000',
      twilio_sms_number: '+61400000001',
      contact_name: 'Sparky Sam',
    }
    const r = await runTradieFlow({ tenantId: 'tenant-A', provider: 'hubspot', tenant })

    // contacts deduped (case-insensitive) + invalid dropped → exactly one
    expect(r.rows.map((x) => x.email)).toEqual(['jo@site.com'])
    // the announcement carries THIS tradie's identity + a working QR + unsub
    expect(r.email.subject).toContain('Atomic Electrical')
    expect(r.email.html).toContain('Atomic Electrical')
    expect(r.email.html).toContain('5 Volt St, Sydney NSW 2000')
    expect(r.email.html).toContain('+61400000001')
    expect(r.email.html).toContain('https://quote-mate-rho.vercel.app/start/tenant-A')
    expect(r.email.html).toContain('data:image/png;base64,')
    expect(r.email.html).toMatch(/unsubscribe/i)
    // unsubscribe token resolves back to THIS tenant + recipient
    expect(parseUnsubscribeToken(r.unsubToken)).toEqual({ tenantId: 'tenant-A', email: 'jo@site.com' })
  })

  it('Tradie B (plumbing, Zoho): full connect → import → announce', async () => {
    vi.stubGlobal('fetch', fetchRouter([
      ['accounts.zoho.com/oauth/v2/token', () =>
        json({ access_token: 'zoho-access-B', refresh_token: 'zoho-refresh-B', expires_in: 3600 })],
      ['zohoapis.com/crm/v3/Contacts', () =>
        json({ data: [
          { id: '10', Email: 'mick@reno.com', First_Name: 'Mick', Last_Name: 'Pipes' },
        ], info: { more_records: false } })],
    ]))

    const tenant: AnnouncementTenant = {
      business_name: 'Reno Plumbing',
      business_address: '9 Drain Rd, Brisbane QLD 4000',
      twilio_sms_number: '+61400000002',
      contact_name: 'Mick',
    }
    const r = await runTradieFlow({ tenantId: 'tenant-B', provider: 'zoho', tenant })

    expect(r.rows.map((x) => x.email)).toEqual(['mick@reno.com'])
    expect(r.email.html).toContain('Reno Plumbing')
    expect(r.email.html).toContain('9 Drain Rd, Brisbane QLD 4000')
    expect(r.email.html).toContain('+61400000002')
    expect(r.email.html).toContain('https://quote-mate-rho.vercel.app/start/tenant-B')
    expect(parseUnsubscribeToken(r.unsubToken)).toEqual({ tenantId: 'tenant-B', email: 'mick@reno.com' })
  })

  it('tenants stay isolated — state + tokens + branding never cross', () => {
    const aState = makeOAuthState('tenant-A', 'hubspot')
    const bState = makeOAuthState('tenant-B', 'zoho')
    // each state resolves only to its own tenant/provider
    expect(parseOAuthState(aState)).toEqual({ tenantId: 'tenant-A', provider: 'hubspot' })
    expect(parseOAuthState(bState)).toEqual({ tenantId: 'tenant-B', provider: 'zoho' })

    // an unsubscribe token minted for A's contact can't be read as B's
    const aToken = makeUnsubscribeToken('tenant-A', 'shared@x.com')
    const parsed = parseUnsubscribeToken(aToken)
    expect(parsed?.tenantId).toBe('tenant-A')
    expect(parsed?.tenantId).not.toBe('tenant-B')

    // a token encrypted under the key round-trips; ciphertext leaks nothing
    const ct = encryptSecret('tenant-A-access-token')
    expect(ct).not.toContain('tenant-A-access-token')
    expect(decryptSecret(ct)).toBe('tenant-A-access-token')
  })

  it('a stale/expired OAuth state is rejected (callback safety)', () => {
    const state = makeOAuthState('tenant-A', 'hubspot')
    const sixteenMinutesLater = Date.now() + 16 * 60 * 1000
    expect(parseOAuthState(state, sixteenMinutesLater)).toBeNull()
  })
})
