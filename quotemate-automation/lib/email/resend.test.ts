import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from '@/lib/email/resend'

describe('lib/email/resend', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.RESEND_FROM_EMAIL = 'QuoteMax <noreply@quotemate.com.au>'
  })
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL
    vi.unstubAllGlobals()
  })

  it('posts to the Resend API and returns the message id on success', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' })
    expect(r).toEqual({ ok: true, messageId: 'msg_123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent).toMatchObject({ to: 'a@b.com', subject: 'Hi', from: expect.stringContaining('noreply') })
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer test-key' })
  })

  it('returns a failure union on a non-2xx response (does not throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: 'invalid to address' }), { status: 422 }),
    ))
    const r = await sendEmail({ to: 'bad', subject: 's', html: 'h' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('http_422')
      expect(r.reason).toMatch(/invalid to address/)
    }
  })

  it('returns a network_error union when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up') }))
    const r = await sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })
    expect(r).toMatchObject({ ok: false, code: 'network_error' })
  })

  it('fails fast (no fetch) when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })
    expect(r).toMatchObject({ ok: false, code: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when no from address is configured', async () => {
    delete process.env.RESEND_FROM_EMAIL
    vi.stubGlobal('fetch', vi.fn())
    const r = await sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })
    expect(r).toMatchObject({ ok: false, code: 'not_configured' })
  })
})
