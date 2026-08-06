// Spec painting-auto-send R2/R3 — the SMS/voice origin texts the customer the
// FULL QUOTE (not the holding message), and a send that fails is never
// reported as a success: the release is rolled back (inside the shared
// autoSendPaintingQuote helper) and the tradie is told the customer got
// nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaintingSlots } from './painting-intake'

const h = vi.hoisted(() => ({
  runAndSavePaintingQuote: vi.fn(),
  autoSendPaintingQuote: vi.fn(),
  notifyPaintingTradie: vi.fn(async () => ({ notified: true })),
  dispatchQuoteMessage: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/painting/quote-dispatch', () => ({
  runAndSavePaintingQuote: h.runAndSavePaintingQuote,
}))
vi.mock('@/lib/painting/release', () => ({
  notifyPaintingTradie: h.notifyPaintingTradie,
  autoSendPaintingQuote: h.autoSendPaintingQuote,
}))
vi.mock('./dispatch', () => ({ dispatchQuoteMessage: h.dispatchQuoteMessage }))

import { estimateAndDispatchPainting } from './painting-estimate-dispatch'

const supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
  }),
} as unknown as SupabaseClient

const slots: PaintingSlots = {
  address: '5 Smith St',
  postcode: '2000',
  state: 'NSW',
  scopes: ['walls'],
  coats: 2,
  condition: 'sound',
  ceiling_height: 'standard',
  storeys: 1,
  colour_change: false,
}

const pricedDisp = {
  ok: true as const,
  token: 'pub-1',
  estimateToken: 'est-1',
  inspection: false,
  estimate: {
    price: { routing: { decision: 'auto_quote', reason: '' }, tiers: [{ tier: 'better', inc_gst: 12000 }] },
  },
}

function run(sendReply: (text: string, mediaUrl?: string) => Promise<{ ok: boolean }>) {
  return estimateAndDispatchPainting({
    supabase,
    tenantId: null,
    customerPhone: '+61400000000',
    firstName: 'Sam',
    baseUrl: 'https://x.test',
    slots,
    sendReply,
  })
}

beforeEach(() => {
  h.runAndSavePaintingQuote.mockReset().mockResolvedValue(pricedDisp)
  // Default: the shared helper delivers, exercising its injected `send`.
  h.autoSendPaintingQuote.mockReset().mockImplementation(async (args: {
    send: (text: string, mmsUrl?: string) => Promise<boolean>
  }) => ({
    sent: await args.send('Better $12,000 inc GST https://x.test/q/paint/pub-1', 'https://pdf'),
  }))
  h.notifyPaintingTradie.mockClear()
})

describe('estimateAndDispatchPainting — auto-send', () => {
  it('texts the full quote with the PDF attached, not the holding message (R2)', async () => {
    const sendReply = vi.fn(async (_text: string, _mediaUrl?: string) => ({ ok: true }))
    const r = await run(sendReply)

    expect(r.ok).toBe(true)
    expect(sendReply).toHaveBeenCalledTimes(1)
    expect(sendReply).toHaveBeenCalledWith(
      expect.stringContaining('https://x.test/q/paint/pub-1'),
      'https://pdf',
    )
    expect(sendReply.mock.calls[0][0]).not.toMatch(/is preparing your painting quote/i)
    expect(h.notifyPaintingTradie).toHaveBeenCalledWith(
      expect.objectContaining({ customerTexted: true }),
    )
  })

  it('routes the send through the shared helper, which owns stamp-vs-revert', async () => {
    await run(vi.fn(async (_text: string, _mediaUrl?: string) => ({ ok: true })))
    expect(h.autoSendPaintingQuote).toHaveBeenCalledWith(
      expect.objectContaining({ disp: pricedDisp, appUrl: 'https://x.test', supabase }),
    )
  })

  it('falls back to the holding message and flags the tradie when the send fails (R3)', async () => {
    const sendReply = vi.fn(async (_text: string, _mediaUrl?: string) => ({ ok: false }))
    await run(sendReply)

    // Customer still hears something — the holding message, no price.
    expect(sendReply).toHaveBeenCalledTimes(2)
    expect(sendReply.mock.calls[1][0]).toMatch(/is preparing your painting quote/i)
    expect(h.notifyPaintingTradie).toHaveBeenCalledWith(
      expect.objectContaining({ customerTexted: false }),
    )
  })

  it('leaves an inspection-routed request on its on-site-measure message', async () => {
    h.runAndSavePaintingQuote.mockResolvedValue({
      ...pricedDisp,
      inspection: true,
      estimate: { price: { routing: { decision: 'inspection_required', reason: 'three storeys' } } },
    })
    const sendReply = vi.fn(async (_text: string, _mediaUrl?: string) => ({ ok: true }))
    const r = await run(sendReply)

    expect(r.ok && r.inspection).toBe(true)
    expect(sendReply).toHaveBeenCalledTimes(1)
    expect(sendReply.mock.calls[0][0]).toMatch(/before we can quote accurately/i)
    expect(h.autoSendPaintingQuote).not.toHaveBeenCalled()
    expect(h.notifyPaintingTradie).not.toHaveBeenCalled()
  })
})
