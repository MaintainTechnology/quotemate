// TAG intake through Resend (TKO-24, DEC-031): the webhook's signature, the
// HTML fallback, and the received email fetched into an intake message, over
// a fake fetch. No request leaves the test.

import { createHmac, randomBytes } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { fetchResendMessage, htmlToText, verifyResendWebhook } from './resend-intake'

const SECRET = `whsec_${randomBytes(24).toString('base64')}`
const NOW = Date.parse('2026-11-04T02:00:00.000Z')
const sign = (id: string, timestamp: string, body: string | Uint8Array, secret = SECRET) =>
  createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64')).update(`${id}.${timestamp}.`).update(body).digest('base64')

describe('verifyResendWebhook', () => {
  const body = '{"type":"email.received","data":{"email_id":"e-1"}}'
  const timestamp = String(NOW / 1000)
  const headers = (over: Partial<Record<'id' | 'timestamp' | 'signature', string>> = {}) => ({
    id: 'msg_1', timestamp, signature: `v1,${sign('msg_1', timestamp, body)}`, ...over,
  })

  it('accepts a body signed with the secret, among other signatures too', () => {
    expect(verifyResendWebhook(body, headers(), SECRET, NOW)).toBe(true)
    expect(verifyResendWebhook(body, headers({ signature: `v1,${sign('msg_1', timestamp, body, `whsec_${randomBytes(24).toString('base64')}`)} v1,${sign('msg_1', timestamp, body)}` }), SECRET, NOW)).toBe(true)
  })

  it('refuses another secret, a changed body, a changed id, or a signature of another version', () => {
    expect(verifyResendWebhook(body, headers(), `whsec_${randomBytes(24).toString('base64')}`, NOW)).toBe(false)
    expect(verifyResendWebhook(`${body} `, headers(), SECRET, NOW)).toBe(false)
    expect(verifyResendWebhook(body, headers({ id: 'msg_2' }), SECRET, NOW)).toBe(false)
    expect(verifyResendWebhook(body, headers({ signature: `v2,${sign('msg_1', timestamp, body)}` }), SECRET, NOW)).toBe(false)
  })

  it('refuses a timestamp more than five minutes from now, and missing headers or a malformed secret', () => {
    for (const offset of [-301, 301]) {
      const ts = String(NOW / 1000 + offset)
      expect(verifyResendWebhook(body, { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` }, SECRET, NOW)).toBe(false)
    }
    expect(verifyResendWebhook(body, headers({ signature: '' }), SECRET, NOW)).toBe(false)
    expect(verifyResendWebhook(body, { id: 'msg_1', timestamp }, SECRET, NOW)).toBe(false)
    expect(verifyResendWebhook(body, headers(), SECRET.slice('whsec_'.length), NOW)).toBe(false)
  })

  it('refuses a secret too short to be one, as whsec_ alone would let anyone sign', () => {
    for (const secret of ['whsec_', 'whsec_====', `whsec_${randomBytes(10).toString('base64')}`]) {
      const signature = `v1,${sign('msg_1', timestamp, body, secret)}`
      expect(verifyResendWebhook(body, { id: 'msg_1', timestamp, signature }, secret, NOW)).toBe(false)
    }
  })

  it('checks the bytes as sent, not the text they decode to', () => {
    const bytes = (last: number) => Buffer.concat([Buffer.from('{"type":"email.received","x":"'), Buffer.from([last]), Buffer.from('"}')])
    const signature = `v1,${sign('msg_1', timestamp, bytes(0xff))}`
    expect(verifyResendWebhook(bytes(0xff), { id: 'msg_1', timestamp, signature }, SECRET, NOW)).toBe(true)
    // Both bytes decode to the same replacement character.
    expect(verifyResendWebhook(bytes(0xfe), { id: 'msg_1', timestamp, signature }, SECRET, NOW)).toBe(false)
  })
})

describe('htmlToText', () => {
  it('ends blocks with line breaks, drops tags and decodes the common entities once', () => {
    const html = '<div>Notes pertaining to this quote</div><ul><li><b>Roofing - Steel (Supply &amp; Fit)</b></li></ul>Line one<br>Line&nbsp;two &amp;lt;kept&amp;gt;'
    expect(htmlToText(html)).toBe('Notes pertaining to this quote\n\nRoofing - Steel (Supply & Fit)\n\nLine one\nLine two &lt;kept&gt;')
  })

  it('reads a run of unclosed tags in bounded time', () => {
    const started = performance.now()
    htmlToText('<'.repeat(400_000))
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('leaves no tag behind, even one a single pass rebuilds from the pieces round another', () => {
    expect(htmlToText('<<b>script>alert(1)<</b>/script>')).toBe('scriptalert(1)/script')
    expect(htmlToText('Site <scr<b>ipt notes')).toBe('Site script notes')
    // A bracket the sender wrote as an entity is text, and stays.
    expect(htmlToText('5 &lt; 6 &gt; 4')).toBe('5 < 6 > 4')
  })

  it('strips nested brackets in bounded time', () => {
    const started = performance.now()
    htmlToText('<'.repeat(200_000) + 'a' + '>'.repeat(200_000))
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe('fetchResendMessage', () => {
  const EMAIL = 'e-7'
  const PDF_A = new Uint8Array(Buffer.from('%PDF-1.7 architectural'))
  const PDF_E = new Uint8Array(Buffer.from('%PDF-1.7 engineering'))
  const email = (over: Record<string, unknown> = {}) => ({
    object: 'email',
    id: EMAIL,
    to: ['Takeoffs <takeoffs@intake.example>'],
    subject: 'Fw: RESEND of Quote Request: 12 Sample St, Exampleton (J10001)',
    text: 'Could you please submit a quotation by 9/10/2026 for 12 Sample St, Exampleton 4305.',
    html: '<p>ignored while there is text</p>',
    attachments: [
      { id: 'a-1', filename: 'Architectural.pdf', content_type: 'application/pdf', size: PDF_A.length },
      { id: 'a-2', filename: 'image001.png', content_type: 'image/png', size: 4096 },
      { id: 'a-3', filename: 'Engineering', content_type: 'application/pdf', size: PDF_E.length },
    ],
    ...over,
  })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  // Where Resend's received-file links really point (staging, 5 November).
  const cdn = (id: string) => `https://cdn.resend.app/${EMAIL}/attachments/${id}?signature=sig`
  const fakeFetch = (record = email(), downloads: Record<string, Uint8Array> = { 'a-1': PDF_A, 'a-3': PDF_E }) =>
    vi.fn(async (url: string) => {
      const path = new URL(url)
      if (path.hostname === 'api.resend.com' && path.pathname === `/emails/receiving/${EMAIL}`) return json(record)
      const attachment = /^\/emails\/receiving\/e-7\/attachments\/([\w-]+)$/.exec(path.pathname)?.[1]
      if (path.hostname === 'api.resend.com' && attachment) return json({ object: 'attachment', id: attachment, download_url: cdn(attachment) })
      const download = /\/attachments\/([\w-]+)$/.exec(path.pathname)?.[1]
      if (path.hostname === 'cdn.resend.app' && download && downloads[download]) return new Response(new Uint8Array(downloads[download]))
      return json({ message: 'not found' }, 404)
    })
  const LIMITS = { apiKey: 're_test_key', address: 'takeoffs@intake.example', maxFiles: 10, maxFileBytes: 1_000_000 }

  it("makes the email an intake message: its subject, its text and its PDFs' bytes, the image never fetched", async () => {
    const fetch = fakeFetch()
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch })).resolves.toEqual({
      ok: true,
      message: {
        message_id: `resend:${EMAIL}`,
        subject: email().subject,
        text: email().text,
        attachments: [
          { filename: 'Architectural.pdf', content_type: 'application/pdf', content: PDF_A },
          { filename: 'Engineering', content_type: 'application/pdf', content: PDF_E },
        ],
      },
    })
    const urls = fetch.mock.calls.map(([url]) => url)
    expect(urls.some((url) => url.includes('a-2'))).toBe(false)
    expect(urls[0]).toContain('html_format=cid')
  })

  it("sends the key to Resend's API only, never to the download host", async () => {
    const fetch = fakeFetch()
    await fetchResendMessage(EMAIL, { ...LIMITS, fetch })
    for (const [url, init] of fetch.mock.calls as unknown as Array<[string, RequestInit | undefined]>) {
      const auth = new Headers(init?.headers).get('authorization')
      expect(auth).toBe(new URL(url).hostname === 'api.resend.com' ? 'Bearer re_test_key' : null)
    }
  })

  it('reads the HTML when the email has no text part', async () => {
    const fetch = fakeFetch(email({ text: null, html: '<p>Notes pertaining to this quote</p><p>Roofing</p>' }))
    const fetched = await fetchResendMessage(EMAIL, { ...LIMITS, fetch })
    expect(fetched.ok && fetched.message.text).toBe('Notes pertaining to this quote\n\nRoofing')
  })

  it('takes only mail sent to the intake address, by any header or by the envelope a forward was delivered to', async () => {
    for (const over of [
      { to: ['TAKEOFFS@intake.example'] },
      { to: ['jon@roofer.example'], cc: ['Takeoffs <takeoffs@intake.example>'] },
      // An auto-forward keeps the first recipient in its headers.
      { to: ['jon@roofer.example'], received_for: ['takeoffs@intake.example'] },
    ]) {
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: fakeFetch(email(over)) })).resolves.toMatchObject({ ok: true })
    }
    const other = fakeFetch(email({ to: ['quotes@intake.example'], received_for: ['quotes@intake.example'] }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: other })).resolves.toMatchObject({ ok: false, error: 'not_for_intake' })
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('reads every address in a list joined by commas, and takes the address, not what a display name says', async () => {
    for (const over of [
      { to: ['Jon <jon@roofer.example>, Takeoffs <takeoffs@intake.example>'] },
      { to: ['"Smith, Jon" <jon@roofer.example>', '"<Jon>" <takeoffs@intake.example>'] },
      { to: ['jon@roofer.example'], received_for: 'jon@roofer.example, takeoffs@intake.example' },
    ]) {
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: fakeFetch(email(over)) })).resolves.toMatchObject({ ok: true })
    }
    const named = fakeFetch(email({ to: ['"Takeoffs <takeoffs@intake.example>" <someone@elsewhere.example>'] }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: named })).resolves.toMatchObject({ ok: false, error: 'not_for_intake' })
  })

  it('takes mail only from the senders it is given, by their address and not a display name, before downloading any', async () => {
    const senders = ['jon@maintain.example']
    for (const from of ['Jon <jon@maintain.example>', 'JON@maintain.example']) {
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, senders, fetch: fakeFetch(email({ from })) })).resolves.toMatchObject({ ok: true })
    }
    const stranger = fakeFetch(email({ from: '"jon@maintain.example" <someone@elsewhere.example>' }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, senders, fetch: stranger })).resolves.toMatchObject({ ok: false, error: 'sender_not_allowed' })
    expect(stranger).toHaveBeenCalledTimes(1)
    // Without a list, any sender is taken.
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: fakeFetch(email({ from: 'someone@elsewhere.example' })) })).resolves.toMatchObject({ ok: true })
  })

  it('answers what Resend would answer again as a refusal; its own trouble and a refused key throw, so the webhook comes again', async () => {
    const answering = (status: number, at: 'email' | 'attachment' | 'download') => {
      const base = fakeFetch()
      return vi.fn(async (url: string) => {
        const path = new URL(url)
        const hit = at === 'email' ? path.pathname === `/emails/receiving/${EMAIL}`
          : at === 'attachment' ? path.hostname === 'api.resend.com' && path.pathname.includes('/attachments/')
            : path.hostname === 'cdn.resend.app'
        if (!hit) return base(url)
        return new Response(null, { status, headers: status < 400 ? { location: 'https://elsewhere.example/moved' } : {} })
      })
    }
    for (const [status, at] of [[404, 'email'], [302, 'email'], [404, 'attachment'], [410, 'download'], [302, 'download']] as const) {
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: answering(status, at) }))
        .resolves.toMatchObject({ ok: false, error: 'email_unavailable', detail: expect.stringContaining(String(status)) })
    }
    for (const [status, at] of [[503, 'email'], [429, 'attachment'], [500, 'download'], [403, 'download']] as const) {
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: answering(status, at) })).rejects.toThrow(String(status))
    }
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: answering(401, 'email') })).rejects.toThrow('full-access')
  })

  it('never follows a redirect, so it reaches only the hosts it checked', async () => {
    const fetch = fakeFetch()
    await fetchResendMessage(EMAIL, { ...LIMITS, fetch })
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit | undefined]>
    expect(calls.length).toBe(5)
    for (const [, init] of calls) expect(init?.redirect).toBe('manual')
  })

  it('stops a download at the limit, however long it runs or says it is, and refuses it', async () => {
    const unsized = email({ attachments: [{ id: 'a-1', filename: 'Architectural.pdf', content_type: 'application/pdf', size: null }] })
    const serving = (download: () => Response) => {
      const base = fakeFetch(unsized)
      return vi.fn(async (url: string) => (new URL(url).hostname === 'cdn.resend.app' ? download() : base(url)))
    }
    const endless = () => new Response(new ReadableStream<Uint8Array>({ pull: (controller) => controller.enqueue(new Uint8Array(64 * 1024)) }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: serving(endless) })).resolves.toMatchObject({ ok: false, error: 'too_large' })
    const declared = () => new Response(new Uint8Array(10), { headers: { 'content-length': String(2 * LIMITS.maxFileBytes) } })
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch: serving(declared) })).resolves.toMatchObject({ ok: false, error: 'too_large' })
  })

  it('refuses PDFs that come to more than 40 MB in all, before downloading any', async () => {
    const MB = 1_048_576
    const big = (id: string) => ({ id, filename: `${id}.pdf`, content_type: 'application/pdf', size: 15 * MB })
    const fetch = fakeFetch(email({ attachments: [big('a-1'), big('a-2'), big('a-3')] }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, maxFileBytes: 50 * MB, fetch }))
      .resolves.toMatchObject({ ok: false, error: 'too_large', detail: expect.stringContaining('40 MB') })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses a PDF Resend gave no size for that proves larger than a file may be, rather than failing on every delivery', async () => {
    const fetch = fakeFetch(email({ attachments: [{ id: 'a-1', filename: 'Architectural.pdf', content_type: 'application/pdf', size: null }] }))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, maxFileBytes: PDF_A.length - 1, fetch }))
      .resolves.toMatchObject({ ok: false, error: 'too_large', detail: expect.stringContaining('Architectural.pdf') })
  })

  it('refuses more PDFs than a run takes, or one larger than a file may be, before downloading any', async () => {
    const many = fakeFetch()
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, maxFiles: 1, fetch: many })).resolves.toMatchObject({ ok: false, error: 'too_many_files' })
    expect(many).toHaveBeenCalledTimes(1)
    const large = fakeFetch()
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, maxFileBytes: PDF_E.length, fetch: large }))
      .resolves.toMatchObject({ ok: false, error: 'too_large', detail: expect.stringContaining('Architectural.pdf') })
    expect(large).toHaveBeenCalledTimes(1)
  })

  it("fails on an error from Resend's API, so the webhook is delivered again", async () => {
    const fetch = vi.fn(async () => json({ message: 'unavailable' }, 503))
    await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch })).rejects.toThrow('503')
  })

  it("downloads from either of Resend's domains: cdn.resend.app, where its links point, and resend.com", async () => {
    for (const host of ['cdn.resend.app', 'inbound-cdn.resend.com']) {
      const fetch = vi.fn(async (url: string) => {
        const path = new URL(url)
        if (path.pathname === `/emails/receiving/${EMAIL}`) return json(email({ attachments: [email().attachments[0]] }))
        if (path.hostname === 'api.resend.com') return json({ object: 'attachment', download_url: `https://${host}/a-1?signature=sig` })
        if (path.hostname === host) return new Response(new Uint8Array(PDF_A))
        throw new Error(`fetched ${url}`)
      })
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch })).resolves.toMatchObject({ ok: true })
    }
  })

  it("downloads from Resend's own hosts only, over https, and refuses a link anywhere else", async () => {
    for (const link of ['https://evil.example/attachment', 'https://resend.com.evil.example/a', 'https://resend.app.evil.example/a', 'http://cdn.resend.app/a', 'http://inbound-cdn.resend.com/a', 'not a link']) {
      const fetch = vi.fn(async (url: string) => {
        const path = new URL(url)
        if (path.pathname === `/emails/receiving/${EMAIL}`) return json(email())
        if (path.hostname === 'api.resend.com') return json({ object: 'attachment', download_url: link })
        throw new Error(`fetched ${url}`)
      })
      await expect(fetchResendMessage(EMAIL, { ...LIMITS, fetch })).resolves.toMatchObject({ ok: false, error: 'email_unavailable' })
    }
  })
})
