// The behaviour the customer actually sees after a roofing call ends.
//
// Pins the 2026-07-23 report: "it didn't perform the measurement, it prompted
// me to continue via text". After a call where the address was read back and
// agreed, the FIRST SMS must be the buildings/confirm-roof message carrying
// the /q/roof/<token> link — never the address question again — and the
// persisted roofing_state must be the one /api/sms/inbound resumes from.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.fn()
const measureAndDispatchRoofing = vi.fn()
const dispatchQuoteMessage = vi.fn()
const screenAddressForAutoRun = vi.fn()
const screenConfirmAddress = vi.fn()

vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@ai-sdk/anthropic', () => ({ anthropic: (m: string) => m }))
vi.mock('@/lib/sms/dispatch', () => ({
  dispatchQuoteMessage: (...a: unknown[]) => dispatchQuoteMessage(...a),
}))
// Mocked at the AUTO-RUN screen, whose contract is a tagged union
// ('proceed' | 'confirm' | 'reject') — not screenConfirmAddress, whose
// always-present `reply` a previous mock mis-modelled as "no reply on a
// clean match". That mock hid a shipped inversion; the real contract is
// pinned in lib/sms/verify-address-autorun.test.ts against a stubbed API.
vi.mock('@/lib/sms/verify-address', () => ({
  screenAddressForAutoRun: (...a: unknown[]) => screenAddressForAutoRun(...a),
  screenConfirmAddress: (...a: unknown[]) => screenConfirmAddress(...a),
}))
vi.mock('@/lib/sms/roofing-measure-dispatch', () => ({
  measureAndDispatchRoofing: (...a: unknown[]) => measureAndDispatchRoofing(...a),
  ROOFING_APP_BASE_URL: 'https://www.quotemax.com.au',
}))

const { runVoiceTradeHandover } = await import('./trade-handover')

const TENANT = {
  id: 'tenant-1',
  business_name: 'Sparky',
  trade: 'roofing',
  trades: ['roofing'],
  twilio_sms_number: '+61468048422',
}

type Recorded = { table: string; op: 'insert' | 'update'; payload: Record<string, unknown> }

function fakeSupabase(recorded: Recorded[]) {
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
        insert: (payload: Record<string, unknown>) => {
          recorded.push({ table, op: 'insert', payload })
          return chain
        },
        update: (payload: Record<string, unknown>) => {
          recorded.push({ table, op: 'update', payload })
          return chain
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
      })
      return chain
    },
  } as never
}

const CALL_ANSWERS = {
  trade: 'roofing',
  first_name: 'Jeff',
  address: '670 London Road, Chandler QLD 4155',
  address_confirmed: true,
  material: 'colorbond corrugated',
  pitch: 'standard',
  intent: 'full re-roof',
}

beforeEach(() => {
  generateText.mockResolvedValue({ text: JSON.stringify(CALL_ANSWERS) })
  // Clean map-check: verified, uncorrected → safe to measure.
  screenAddressForAutoRun.mockImplementation(async (slots: Record<string, unknown>) => ({
    kind: 'proceed',
    slots: { ...slots, address_confirmed: true, addr_verified: slots.address },
  }))
  screenConfirmAddress.mockImplementation(async (slots: unknown) => ({ slots }))
  dispatchQuoteMessage.mockResolvedValue({ ok: true, sid: 'SM1', channel: 'sms', smsAttempt: {} })
  measureAndDispatchRoofing.mockResolvedValue({
    ok: true,
    token: 'tok123',
    quote: { structures: [{}, {}, {}] },
    state: {
      slots: { address: '670 London Road, Chandler QLD 4155' },
      last_step: 'confirm_roof',
      pending_quote_token: 'tok123',
      pending_structure_count: 3,
    },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('runVoiceTradeHandover — roofing call with the brief agreed', () => {
  it('runs the measurement instead of texting the address question', async () => {
    const recorded: Recorded[] = []
    const handled = await runVoiceTradeHandover({
      supabase: fakeSupabase(recorded),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'AI: ... User: 670 London Road Chandler. AI: is that right? User: yes.',
    })

    expect(handled).toBe(true)
    expect(measureAndDispatchRoofing).toHaveBeenCalledTimes(1)

    // The measure runs on the call's own brief, priced off the tenant's card.
    const args = measureAndDispatchRoofing.mock.calls[0][0]
    expect(args.slots.address_confirmed).toBe(true)
    expect(args.slots.material).toBe('colorbond_corrugated')
    expect(args.isInspection).toBe(false)
    expect(args.tenantTrade).toBe('roofing')
    expect(args.customerPhone).toBe('+61489083371')
    expect(args.replyFrom).toBe('+61468048422')

    // No "what's the address?" bridge SMS was sent by the handover — the
    // confirm-roof message is sent by measureAndDispatchRoofing's sendReply.
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.some((b) => /address/i.test(b))).toBe(false)
  })

  it('persists the state /api/sms/inbound resumes from on "YES"', async () => {
    const recorded: Recorded[] = []
    await runVoiceTradeHandover({
      supabase: fakeSupabase(recorded),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'agreed on the call',
    })

    const stateWrites = recorded.filter(
      (r) => r.table === 'sms_conversations' && r.payload.roofing_state,
    )
    const final = stateWrites[stateWrites.length - 1].payload.roofing_state as Record<string, unknown>
    expect(final.last_step).toBe('confirm_roof')
    expect(final.pending_quote_token).toBe('tok123')
    expect(final.pending_structure_count).toBe(3)
  })

  it('never measures an address the map check rejected — asks by text instead', async () => {
    screenAddressForAutoRun.mockResolvedValue({
      kind: 'reject',
      slots: { address: null },
      reply: "I couldn't find that address — could you send it again?",
    })
    const recorded: Recorded[] = []
    const handled = await runVoiceTradeHandover({
      supabase: fakeSupabase(recorded),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'misheard suburb',
    })

    expect(handled).toBe(true)
    expect(measureAndDispatchRoofing).not.toHaveBeenCalled()
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.join(' ')).toMatch(/send it again/i)
  })

  it('caller never confirmed the address on the call → confirm by text, no measure', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({ ...CALL_ANSWERS, address_confirmed: false }),
    })
    const recorded: Recorded[] = []
    await runVoiceTradeHandover({
      supabase: fakeSupabase(recorded),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'no read-back happened',
    })

    expect(measureAndDispatchRoofing).not.toHaveBeenCalled()
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.join(' ')).toMatch(/is that right/i)
  })

  it('measure unavailable → says so and parks at await_booking (lead never lost)', async () => {
    measureAndDispatchRoofing.mockResolvedValue({ ok: false, reason: 'provider down' })
    const recorded: Recorded[] = []
    const handled = await runVoiceTradeHandover({
      supabase: fakeSupabase(recorded),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'agreed on the call',
    })

    expect(handled).toBe(true)
    const bodies = dispatchQuoteMessage.mock.calls.map((c) => String(c[0].text))
    expect(bodies.length).toBeGreaterThan(0)
    const stateWrites = recorded.filter(
      (r) => r.table === 'sms_conversations' && r.payload.roofing_state,
    )
    const final = stateWrites[stateWrites.length - 1].payload.roofing_state as Record<string, unknown>
    expect(final.last_step).toBe('await_booking')
  })
})

describe('runVoiceTradeHandover — boundaries hold', () => {
  it('an electrical call on a roofing tenant never hands over', async () => {
    generateText.mockResolvedValue({ text: JSON.stringify({ trade: 'other', first_name: 'Jeff' }) })
    const handled = await runVoiceTradeHandover({
      supabase: fakeSupabase([]),
      tenantId: 'tenant-1',
      callerNumber: '+61489083371',
      transcript: 'need a powerpoint installed',
    })
    expect(handled).toBe(false)
    expect(measureAndDispatchRoofing).not.toHaveBeenCalled()
    expect(dispatchQuoteMessage).not.toHaveBeenCalled()
  })
})
