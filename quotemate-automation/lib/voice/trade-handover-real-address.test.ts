// End-to-end guard for the 2026-07-23 inversion.
//
// The first cut of the voice measure path passed its own unit tests because
// they mocked `screenConfirmAddress` with a shape the real module never
// returns for a resolvable address. Against the REAL module, every clean
// match was misread as a correction, so `measureAndDispatchRoofing` was
// never called and the customer got the address question again — the exact
// bug the feature was written to remove.
//
// This test therefore mocks everything EXCEPT lib/sms/verify-address, and
// drives that through a stubbed Google Address Validation response. If the
// gate inverts again, this fails.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn()
const measureAndDispatchRoofing = vi.fn()
const dispatchQuoteMessage = vi.fn()

vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (m: string) => m }))
vi.mock('@/lib/sms/dispatch', () => ({
  dispatchQuoteMessage: (...a: unknown[]) => dispatchQuoteMessage(...a),
}))
vi.mock('@/lib/sms/roofing-measure-dispatch', () => ({
  measureAndDispatchRoofing: (...a: unknown[]) => measureAndDispatchRoofing(...a),
  ROOFING_APP_BASE_URL: 'https://www.quotemax.com.au',
}))
// NOTE: @/lib/sms/verify-address is deliberately NOT mocked.

const { runVoiceTradeHandover } = await import('./trade-handover')

const ENV = { ...process.env }
const ADDRESS = '670 London Road, Chandler QLD 4155'

const TENANT = {
  id: 'tenant-1',
  business_name: 'Sparky',
  trade: 'roofing',
  trades: ['roofing'],
  twilio_sms_number: '+61468048422',
}

function fakeSupabase() {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        in: self,
        order: self,
        limit: self,
        maybeSingle: async () =>
          table === 'tenants' ? { data: TENANT, error: null } : { data: null, error: null },
        single: async () => ({ data: { id: 'convo-1' }, error: null }),
        insert: self,
        update: self,
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      })
      return chain
    },
  } as never
}

/** Stub the Google Address Validation call the real verifier makes. */
function stubGoogle(formatted: string, address: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async () =>
    new Response(
      JSON.stringify({
        result: {
          verdict: { addressComplete: true },
          address: { formattedAddress: formatted, ...address },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
}

beforeEach(() => {
  // Real verifier, real key path, stubbed transport. Geoscape off so the
  // Google branch is the one under test.
  process.env.GOOGLE_ADDRESS_VALIDATION_API_KEY = 'test-key'
  delete process.env.GEOSCAPE_API_KEY
  generateText.mockResolvedValue({
    text: JSON.stringify({
      trade: 'roofing',
      first_name: 'Jeff',
      address: ADDRESS,
      address_confirmed: true,
      material: 'colorbond corrugated',
      pitch: 'standard',
      intent: 'full re-roof',
    }),
  })
  dispatchQuoteMessage.mockResolvedValue({ ok: true, sid: 'SM1', channel: 'sms', smsAttempt: {} })
  measureAndDispatchRoofing.mockResolvedValue({
    ok: true,
    token: 'tok123',
    quote: { structures: [{}, {}, {}] },
    state: { slots: {}, last_step: 'confirm_roof', pending_quote_token: 'tok123', pending_structure_count: 3 },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  process.env = { ...ENV }
})

describe('voice handover against the REAL address verifier', () => {
  it('a clean Google match MEASURES (the shipped bug: it asked for the address instead)', async () => {
    stubGoogle('670 London Road, Chandler QLD 4155, Australia')

    const handled = await runVoiceTradeHandover({
      supabase: fakeSupabase(),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'caller agreed the address on the call',
    })

    expect(handled).toBe(true)
    expect(measureAndDispatchRoofing).toHaveBeenCalledTimes(1)
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.some((b) => /is that right|what's the property address/i.test(b))).toBe(false)
  })

  it('a Google CORRECTION still asks for a text yes before measuring', async () => {
    stubGoogle('15 Schofield Drive, Safety Beach VIC 3936, Australia')
    generateText.mockResolvedValue({
      text: JSON.stringify({
        trade: 'roofing',
        first_name: 'Jeff',
        address: '15 Schofield Drive, Safety Each QLD',
        address_confirmed: true,
        material: 'concrete tiles',
        pitch: 'standard',
        intent: 'full re-roof',
      }),
    })

    await runVoiceTradeHandover({
      supabase: fakeSupabase(),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'misheard suburb',
    })

    expect(measureAndDispatchRoofing).not.toHaveBeenCalled()
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.join(' ')).toMatch(/closest address I can find/i)
  })

  it('an unconfirmed suburb (223 Archer St) asks first — never auto-measured', async () => {
    stubGoogle('223 Archer Street, Chandler QLD 4154, Australia', {
      unconfirmedComponentTypes: ['locality'],
    })
    generateText.mockResolvedValue({
      text: JSON.stringify({
        trade: 'roofing',
        first_name: 'Jeff',
        address: '223 Archer St, Chandler QLD 4154',
        address_confirmed: true,
        material: 'concrete tiles',
        pitch: 'standard',
        intent: 'full re-roof',
      }),
    })

    await runVoiceTradeHandover({
      supabase: fakeSupabase(),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'unconfirmed suburb',
    })

    expect(measureAndDispatchRoofing).not.toHaveBeenCalled()
  })
})
