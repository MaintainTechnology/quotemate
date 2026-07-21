import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the dispatch layer so we assert on what dispatchQuoteWithPdf passes
// down, without touching Twilio. NOTE: the mock specifier must be the
// `@/` alias — a relative './dispatch' specifier is not reliably
// intercepted on this setup (Vitest 4 on Windows resolves the registry
// id differently), which let the real Twilio dispatch run in tests.
const { dispatchQuoteMessage } = vi.hoisted(() => ({
  dispatchQuoteMessage: vi.fn(async (_opts: unknown) => ({
    ok: true as const,
    channel: 'sms' as const,
    sid: 'SM1',
    status: 'queued',
  })),
}))
vi.mock('@/lib/sms/dispatch', () => ({
  dispatchQuoteMessage: (o: unknown) => dispatchQuoteMessage(o),
}))

import {
  dispatchQuoteWithPdf,
  exceedsMmsMediaCap,
  MMS_MEDIA_CAP_BYTES,
} from '@/lib/sms/send-quote-pdf'

describe('exceedsMmsMediaCap (RC-7 — never attach an oversized PDF as MMS media)', () => {
  it('the cap is Twilio’s 5 MB MMS media limit', () => {
    expect(MMS_MEDIA_CAP_BYTES).toBe(5 * 1024 * 1024)
  })
  it('a PDF at or under the cap is attachable (download == MMS == the same file)', () => {
    expect(exceedsMmsMediaCap(0)).toBe(false)
    expect(exceedsMmsMediaCap(1_000_000)).toBe(false)
    expect(exceedsMmsMediaCap(MMS_MEDIA_CAP_BYTES)).toBe(false)
  })
  it('a PDF over the cap must NOT be attached (Twilio fails delivery async — no SMS fallback fires)', () => {
    expect(exceedsMmsMediaCap(MMS_MEDIA_CAP_BYTES + 1)).toBe(true)
  })
  it('an unknown size is treated as attachable (best-effort — never blocks a send)', () => {
    expect(exceedsMmsMediaCap(null)).toBe(false)
    expect(exceedsMmsMediaCap(undefined)).toBe(false)
  })
})

describe('dispatchQuoteWithPdf', () => {
  beforeEach(() => dispatchQuoteMessage.mockClear())

  it('dispatches without media when there is no PDF path', async () => {
    const sign = vi.fn(async () => 'https://signed/never')
    await dispatchQuoteWithPdf({ to: '+61400000000', text: 'hi', pdfPath: null, signMediaUrl: sign })
    expect(sign).not.toHaveBeenCalled()
    expect(dispatchQuoteMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ mediaUrl: expect.anything() }),
    )
  })

  it('attaches the signed media URL when the PDF exists and signing succeeds', async () => {
    const sign = vi.fn(async () => 'https://signed/abc.pdf')
    await dispatchQuoteWithPdf({
      to: '+61400000000',
      text: 'quote ready',
      from: '+61481613464',
      pdfPath: 'quotes/x.pdf',
      signMediaUrl: sign,
    })
    expect(sign).toHaveBeenCalledWith('quotes/x.pdf')
    expect(dispatchQuoteMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+61400000000', from: '+61481613464', mediaUrl: 'https://signed/abc.pdf' }),
    )
  })

  it('degrades to a plain SMS when signing throws (best-effort)', async () => {
    const sign = vi.fn(async () => {
      throw new Error('sign boom')
    })
    const r = await dispatchQuoteWithPdf({
      to: '+61400000000',
      text: 'quote ready',
      pdfPath: 'quotes/x.pdf',
      signMediaUrl: sign,
    })
    expect(r.ok).toBe(true)
    expect(dispatchQuoteMessage).toHaveBeenCalledWith(
      expect.not.objectContaining({ mediaUrl: expect.anything() }),
    )
  })
})
