// The caption track for a tenant's generated trust video. Stateless: the
// spoken script arrives in the query string (it is the video's own audio —
// nothing private), so no token, no DB read, and the response caches forever.

import { describe, it, expect } from 'vitest'
import { GET } from './route'

const call = (qs: string) => GET(new Request(`http://localhost/api/captions${qs}`))

describe('GET /api/captions', () => {
  it('serves a WebVTT track the <track> element will accept', async () => {
    const res = await call(`?s=${encodeURIComponent('Hi there. We are Ric Electrical.')}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/vtt')
    const body = await res.text()
    expect(body.startsWith('WEBVTT')).toBe(true)
    expect(body).toContain('Hi there. We are Ric Electrical.')
    expect(body).toMatch(/00:00:00\.000 --> 00:00:0\d\.\d{3}/)
  })

  it('caches — the same script always yields the same file', async () => {
    const res = await call(`?s=${encodeURIComponent('Hi there.')}`)
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('rejects a missing script rather than serving an empty track', async () => {
    expect((await call('')).status).toBe(400)
    expect((await call('?s=%20%20')).status).toBe(400)
  })

  it('rejects an oversized script — the query string is a public input', async () => {
    const res = await call(`?s=${encodeURIComponent('word '.repeat(500))}`)
    expect(res.status).toBe(400)
  })

  it('flattens newlines so the query string cannot forge its own cue timings', async () => {
    const res = await call(`?s=${encodeURIComponent('One\n\n00:00:01.000 --> 00:00:02.000\nTwo')}`)
    const body = await res.text()
    // A "-->" surviving inside the spoken text is harmless; a second one at the
    // START of a line would be a second cue, with timings the caller chose.
    expect(body.match(/^\d{2}:\d{2}:\d{2}\.\d{3} -->/gm)).toHaveLength(1)
  })
})
