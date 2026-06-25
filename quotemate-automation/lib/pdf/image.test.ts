// Spec quote-pdf-logo-fix R9 + DoD — prepareImage/prepareLogo must return null
// AND log a warning (not fail silently) when the logo fetch fails, so a missing
// logo is traceable. Covers: fetch rejects (unreachable/timeout) and a non-OK
// HTTP response (404 / not public). The no-URL path must stay silent.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareImage, prepareLogo } from './image'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('prepareImage — silent-failure observability', () => {
  it('returns null and warns when the fetch rejects (unreachable URL)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const out = await prepareImage('https://unreachable.invalid/logo.png')

    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({ url: 'https://unreachable.invalid/logo.png' })
  })

  it('returns null and warns on a non-OK response (404 / not public)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    )

    const out = await prepareLogo('https://cdn.example.com/missing.png')

    expect(out).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toMatchObject({
      url: 'https://cdn.example.com/missing.png',
      reason: 'HTTP 404',
    })
  })

  it('returns null without warning when no URL is given', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await prepareImage(null)).toBeNull()
    expect(await prepareImage(undefined)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })
})
