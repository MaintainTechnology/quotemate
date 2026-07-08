// POST /api/quote/[id]/send — manual send/resend of a quote to the customer
// via SMS or email, triggered from the dashboard quote viewer.
//
// Supabase is mocked with a TABLE-KEYED chainable builder (each table has its
// own result queue) so the route's query order can change without breaking the
// tests. Auth, SMS dispatch, PDF and email side effects are module-mocked; the
// pure policy (canSendQuote / resolveCustomerContact / buildQuoteEmail) and the
// SMS template run for real.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  const tables = new Map<string, Result[]>()

  function seed(table: string, ...results: Result[]) {
    tables.set(table, results)
  }

  function from(table: string) {
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'insert', 'eq', 'is', 'limit', 'order']) {
      builder[op] = () => builder
    }
    const next = () => {
      const q = tables.get(table)
      return q && q.length > 0 ? q.shift()! : { data: null, error: null }
    }
    builder.maybeSingle = async () => next()
    builder.then = (
      resolve: (r: Result) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(next()).then(resolve, reject)
    return builder
  }

  return { tables, seed, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: vi.fn() }))
vi.mock('@/lib/sms/send-quote-pdf', () => ({ dispatchQuoteWithPdf: vi.fn() }))
vi.mock('@/lib/quote/pdf', () => ({
  ensureQuotePdf: vi.fn(),
  quotePdfUrl: (token: string) => `https://www.quotemax.com.au/api/q/${token}/pdf`,
  signQuotePdfUrl: vi.fn(async () => 'https://signed.example/quote.pdf'),
  downloadQuotePdf: vi.fn(),
}))
vi.mock('@/lib/quote/lifecycle', () => ({ advanceQuoteStatus: vi.fn() }))
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn() }))

import { POST } from './route'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { dispatchQuoteWithPdf } from '@/lib/sms/send-quote-pdf'
import { ensureQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'
import { advanceQuoteStatus } from '@/lib/quote/lifecycle'
import { sendEmail } from '@/lib/email/resend'

const resolveMock = vi.mocked(resolveTenantRequest)
const dispatchMock = vi.mocked(dispatchQuoteWithPdf)
const ensurePdfMock = vi.mocked(ensureQuotePdf)
const downloadPdfMock = vi.mocked(downloadQuotePdf)
const advanceMock = vi.mocked(advanceQuoteStatus)
const sendEmailMock = vi.mocked(sendEmail)

const params = { params: Promise.resolve({ id: 'quote-1' }) }

function req(body: unknown) {
  return new Request('http://localhost/api/quote/quote-1/send', {
    method: 'POST',
    headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const tenant = { id: 'tenant-1', twilio_sms_number: '+61400000000', business_name: 'Pilot Sparky' }
const identity = { provider: 'clerk' as const, userId: 'u1', email: 'tradie@example.com' }

const baseQuote = {
  id: 'quote-1',
  tenant_id: 'tenant-1',
  intake_id: 'intake-1',
  status: 'draft',
  share_token: 'tok_abc12345xyz',
  good: { label: 'Good', subtotal_ex_gst: 28000, line_items: [] },
  better: null,
  best: null,
  selected_tier: null,
  total_inc_gst: 30800,
  scope_of_works: null,
  assumptions: null,
  estimated_timeframe: null,
  needs_inspection: false,
  inspection_reason: null,
  stripe_links: { good: 'https://stripe.example/sess' },
  deposit_pct: 30,
  display_mode: null,
  price_hold_until: null,
}

const baseIntake = {
  id: 'intake-1',
  caller: { name: 'Jon Smith', phone: '+61411111111', email: 'jon@example.com' },
  suburb: 'Penrith',
  job_type: 'reroof',
  scope: null,
  call_id: null,
  customer_id: null,
  trade: 'roofing',
}

function seedHappyPath(overrides?: { quote?: Record<string, unknown>; intake?: Record<string, unknown> | null }) {
  h.seed('quotes',
    { data: { ...baseQuote, ...(overrides?.quote ?? {}) }, error: null }, // load
    { data: null, error: null }, // price-hold update (sms path)
  )
  h.seed('intakes', {
    data: overrides && 'intake' in overrides ? overrides.intake : baseIntake,
    error: null,
  })
  h.seed('pricing_book', {
    data: { quote_display: null, gst_registered: true, quote_tier_mode: null },
    error: null,
  })
  h.seed('quote_followup_events', { data: null, error: null })
}

beforeEach(() => {
  h.tables.clear()
  resolveMock.mockReset()
  dispatchMock.mockReset()
  ensurePdfMock.mockReset()
  downloadPdfMock.mockReset()
  advanceMock.mockReset()
  sendEmailMock.mockReset()

  resolveMock.mockResolvedValue({ identity, tenant })
  ensurePdfMock.mockResolvedValue('quote-pdfs/quote-1.pdf')
  downloadPdfMock.mockResolvedValue(Buffer.from('pdfbytes'))
  advanceMock.mockResolvedValue({ advanced: true, from: 'draft', to: 'sent' })
})

describe('POST /api/quote/[id]/send', () => {
  it('401 when the caller has no resolvable tenant', async () => {
    resolveMock.mockResolvedValue(null)
    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(401)
  })

  it("403 when the quote belongs to another tenant", async () => {
    h.seed('quotes', { data: { ...baseQuote, tenant_id: 'tenant-other' }, error: null })
    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(403)
  })

  it('404 when the quote does not exist', async () => {
    h.seed('quotes', { data: null, error: null })
    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(404)
  })

  it('409 when the quote is already paid', async () => {
    h.seed('quotes', { data: { ...baseQuote, status: 'paid' }, error: null })
    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(409)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('400 on an unknown channel', async () => {
    const res = await POST(req({ channel: 'carrier-pigeon' }), params)
    expect(res.status).toBe(400)
  })

  it('400 when SMS is requested but no phone is on file anywhere', async () => {
    seedHappyPath({ intake: { ...baseIntake, caller: { name: 'Jon Smith', phone: '' } } })
    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('no_customer_phone')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('sends the SMS to the resolved number from the tenant number and advances to sent', async () => {
    seedHappyPath()
    dispatchMock.mockResolvedValue({ ok: true, channel: 'sms', sid: 'SM123' } as never)

    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, channel: 'sms', sid: 'SM123', status: 'sent' })

    expect(dispatchMock).toHaveBeenCalledTimes(1)
    const arg = dispatchMock.mock.calls[0][0]
    expect(arg.to).toBe('+61411111111')
    expect(arg.from).toBe('+61400000000')
    expect(arg.text).toContain('/q/tok_abc12345xyz')
    expect(advanceMock).toHaveBeenCalledWith(expect.anything(), 'quote-1', 'sent')
  })

  it('502 on dispatch failure and does NOT advance the status or restamp the price hold', async () => {
    seedHappyPath()
    dispatchMock.mockResolvedValue({
      ok: false,
      smsAttempt: { code: 30007, reason: 'carrier filtered' },
    } as never)

    const res = await POST(req({ channel: 'sms' }), params)
    expect(res.status).toBe(502)
    expect(advanceMock).not.toHaveBeenCalled()
    // The seeded quotes queue held [load, hold-update]; a failed dispatch must
    // consume only the load — the hold restamp belongs to a successful send.
    expect(h.tables.get('quotes')!.length).toBe(1)
  })

  it('normalises an AU-local SMS override to E.164 before dispatch', async () => {
    seedHappyPath()
    dispatchMock.mockResolvedValue({ ok: true, channel: 'sms', sid: 'SM456' } as never)

    const res = await POST(req({ channel: 'sms', to: '0412 345 678' }), params)
    expect(res.status).toBe(200)
    expect(dispatchMock.mock.calls[0][0].to).toBe('+61412345678')
  })

  it('400 on an SMS override that is not a valid AU mobile', async () => {
    seedHappyPath()
    const res = await POST(req({ channel: 'sms', to: 'not a number' }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_recipient')
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  it('emails the quote with the PDF attached, honouring a recipient override', async () => {
    seedHappyPath()
    sendEmailMock.mockResolvedValue({ ok: true, messageId: 'msg_1' })

    const res = await POST(req({ channel: 'email', to: 'override@example.com' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, channel: 'email', messageId: 'msg_1', status: 'sent' })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const opts = sendEmailMock.mock.calls[0][0]
    expect(opts.to).toBe('override@example.com')
    expect(opts.replyTo).toBe('tradie@example.com')
    expect(opts.html).toContain('/q/tok_abc12345xyz')
    expect(opts.attachments).toEqual([
      { filename: 'quote-tok_abc1.pdf', content: Buffer.from('pdfbytes').toString('base64') },
    ])
    expect(advanceMock).toHaveBeenCalledWith(expect.anything(), 'quote-1', 'sent')
  })

  it('still emails (link-only) when the PDF cannot be produced', async () => {
    seedHappyPath()
    ensurePdfMock.mockResolvedValue(null)
    sendEmailMock.mockResolvedValue({ ok: true, messageId: 'msg_2' })

    const res = await POST(req({ channel: 'email' }), params)
    expect(res.status).toBe(200)
    const opts = sendEmailMock.mock.calls[0][0]
    expect(opts.to).toBe('jon@example.com')
    expect(opts.attachments).toBeUndefined()
  })

  it('400 when email is requested but no address is on file and none is given', async () => {
    seedHappyPath({ intake: { ...baseIntake, caller: { name: 'Jon Smith' } } })
    const res = await POST(req({ channel: 'email' }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('no_customer_email')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('400 on a malformed email override', async () => {
    seedHappyPath()
    const res = await POST(req({ channel: 'email', to: 'not-an-email' }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_recipient')
  })

  it('502 when the email provider rejects the send, without advancing status', async () => {
    seedHappyPath()
    sendEmailMock.mockResolvedValue({ ok: false, code: 'http_422', reason: 'invalid' })

    const res = await POST(req({ channel: 'email' }), params)
    expect(res.status).toBe(502)
    expect(advanceMock).not.toHaveBeenCalled()
  })
})
