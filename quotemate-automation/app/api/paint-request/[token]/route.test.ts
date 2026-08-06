// Spec painting-auto-send R2/R3 — the self-serve form POST is the SECOND
// auto-send origin and was shipping untested. It must text the full quote (not
// the holding message), route through the shared autoSendPaintingQuote helper
// so stamp-vs-revert cannot drift from the SMS twin, and never report a send
// that a carrier refused — including the no-customer_phone case.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const results: Result[] = []
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const updates: { table: string; patch: Record<string, unknown> }[] = []

  function from(table: string) {
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'maybeSingle']) {
      builder[op] = () => builder
    }
    builder.update = (patch: Record<string, unknown>) => {
      updates.push({ table, patch })
      return builder
    }
    builder.insert = (row: Record<string, unknown>) => {
      inserts.push({ table, row })
      return builder
    }
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return {
    results,
    inserts,
    updates,
    client: { from },
    runAndSavePaintingQuote: vi.fn(),
    composePaintingQuoteDelivery: vi.fn(async () => ({ text: 'Better $12,000 — https://x.test/q/paint/pub-1', mmsUrl: 'https://pdf' })),
    autoSendPaintingQuote: vi.fn(),
    notifyPaintingTradie: vi.fn(async () => ({ notified: true })),
    sendSms: vi.fn(async () => ({ ok: true, sid: 'SM1' })),
    dispatchQuoteMessage: vi.fn(async () => ({ ok: true })),
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/painting/quote-dispatch', () => ({
  runAndSavePaintingQuote: h.runAndSavePaintingQuote,
  composePaintingQuoteDelivery: h.composePaintingQuoteDelivery,
}))
vi.mock('@/lib/painting/release', () => ({
  notifyPaintingTradie: h.notifyPaintingTradie,
  autoSendPaintingQuote: h.autoSendPaintingQuote,
}))
vi.mock('@/lib/sms/twilio', () => ({ sendSms: h.sendSms }))
vi.mock('@/lib/sms/dispatch', () => ({ dispatchQuoteMessage: h.dispatchQuoteMessage }))

import { POST } from './route'

const lead = {
  token: 'lead-tok',
  tenant_id: 't1',
  conversation_id: null,
  customer_phone: '+61400000000',
  status: 'new',
}

const pricedDisp = {
  ok: true as const,
  token: 'pub-1',
  estimateToken: 'est-1',
  inspection: false,
  estimate: { price: { routing: { decision: 'auto_quote', reason: '' }, tiers: [{ tier: 'better', inc_gst: 12000 }] } },
}

const body = {
  address: { address: '5 Smith St', postcode: '2000', state: 'NSW' },
  inputs: {
    scopes: ['walls'],
    coats: 2,
    condition: 'sound',
    ceiling_height: 'standard',
    colour_change: false,
    storeys: 1,
  },
}

function req() {
  return new Request('http://localhost/api/paint-request/lead-tok', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ token: 'lead-tok' }) }

/** Queue: lead lookup → (lead update) → tenant lookup. */
function queueHappyPath(leadRow: Record<string, unknown> = lead) {
  h.results.push(
    { data: leadRow, error: null },
    { data: null, error: null },
    { data: { owner_mobile: '+61411111111', owner_first_name: 'Jo', twilio_sms_number: '+61480000000', business_name: 'Acme' }, error: null },
  )
}

beforeEach(() => {
  h.results.length = 0
  h.inserts.length = 0
  h.updates.length = 0
  h.runAndSavePaintingQuote.mockReset().mockResolvedValue(pricedDisp)
  h.notifyPaintingTradie.mockClear()
  h.sendSms.mockReset().mockResolvedValue({ ok: true, sid: 'SM1' })
  // Default: the shared helper delivers, exercising the route's injected send.
  h.autoSendPaintingQuote.mockReset().mockImplementation(async (a: {
    send: (text: string, mmsUrl?: string) => Promise<boolean>
  }) => ({ sent: await a.send('Better $12,000 — https://x.test/q/paint/pub-1', 'https://pdf') }))
})

describe('POST /api/paint-request/[token] — priced auto-send', () => {
  it('texts the full quote with the PDF, never the holding message (R2)', async () => {
    queueHappyPath()
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, inspection: false })

    expect(h.sendSms).toHaveBeenCalledTimes(1)
    expect(h.sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+61400000000',
        text: expect.stringContaining('/q/paint/pub-1'),
        mediaUrl: 'https://pdf',
      }),
    )
    expect(h.notifyPaintingTradie).toHaveBeenCalledWith(
      expect.objectContaining({ customerTexted: true }),
    )
  })

  it('routes through the shared helper so stamp-vs-revert matches the SMS origin', async () => {
    queueHappyPath()
    await POST(req(), ctx)
    expect(h.autoSendPaintingQuote).toHaveBeenCalledWith(
      expect.objectContaining({ disp: pricedDisp, tenantId: 't1' }),
    )
  })

  it('reports the send as failed and warns the tradie when Twilio refuses (R3)', async () => {
    h.sendSms.mockResolvedValueOnce({ ok: false, code: '21610', reason: 'unsubscribed' } as never)
    queueHappyPath()
    await POST(req(), ctx)

    expect(h.notifyPaintingTradie).toHaveBeenCalledWith(
      expect.objectContaining({ customerTexted: false }),
    )
    // Second call is the holding-message fallback — no price leaked.
    expect(h.sendSms).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ text: expect.stringMatching(/is preparing your painting quote/i) }),
    )
  })

  it('never claims a send when the lead has no customer_phone', async () => {
    queueHappyPath({ ...lead, customer_phone: null })
    await POST(req(), ctx)

    expect(h.sendSms).not.toHaveBeenCalled()
    expect(h.notifyPaintingTradie).toHaveBeenCalledWith(
      expect.objectContaining({ customerTexted: false }),
    )
  })

  it('leaves an inspection-routed request on its own message, with no auto-send', async () => {
    h.runAndSavePaintingQuote.mockResolvedValue({ ...pricedDisp, inspection: true })
    queueHappyPath()
    const res = await POST(req(), ctx)

    expect(await res.json()).toMatchObject({ ok: true, inspection: true })
    expect(h.autoSendPaintingQuote).not.toHaveBeenCalled()
    expect(h.notifyPaintingTradie).not.toHaveBeenCalled()
  })
})
